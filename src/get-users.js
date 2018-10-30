'use strict';

const logger = require('@financial-times/lambda-logger');
const has = require('lodash.has');
const got = require('got');
const https = require('https');

// We only care about the total so the lowest page size will work
const REPOSITORIES_PAGE_SIZE = 1;
// Queries are fairly slow with large results. Setting this too large busts the github API and results in 502s
const USERS_PAGE_SIZE = 10;

const getUsersQuery = ({ cursor, first, organisation }) => {
	const membersQueryList = [];
	if (first) {
		membersQueryList.push(`first: ${first}`);
	}
	if (cursor) {
		membersQueryList.push(`after: "${cursor}"`);
	}
	const membersQuery = membersQueryList.join(', ');
	const repositoriesQueryList = [
		`first: ${REPOSITORIES_PAGE_SIZE}`,
		`includeUserRepositories: false`,
	];

	const privacyQuery = privacyStatus => `privacy: ${privacyStatus}`;
	const publicRepositoriesQuery = [
		...repositoriesQueryList,
		privacyQuery('PUBLIC'),
	].join(', ');
	const privateRepositoriesQuery = [
		...repositoriesQueryList,
		privacyQuery('PRIVATE'),
	].join(', ');
	return `{
	organization(login: "${organisation}") {
		members(${membersQuery}) {
			nodes {
				login
				name
				email
				publicRepositoriesContributedTo: repositoriesContributedTo(${publicRepositoriesQuery}) {
					totalCount
				}
				privateRepositoriesContributedTo: repositoriesContributedTo(${privateRepositoriesQuery}) {
					totalCount
				}
			}
			totalCount
			pageInfo {
				hasNextPage
				endCursor
			}
		}
	}
}`;
};

const getGithubGraphQlClient = githubAccessToken =>
	got.extend({
		baseUrl: 'https://api.github.com',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `bearer ${githubAccessToken}`,
			'User-Agent': 'FT-github-active-users',
		},

		json: true,
		retry: {
			retries: 2,
			methods: ['POST'],
		},
		agent: {
			https: new https.Agent({ keepAlive: true }),
		},
	});

const makeRequest = (client, query) => {
	return client.post('/graphql', {
		body: {
			query,
		},
	});
};

const getPeople = async ({ client, organisation }) => {
	const query = `{
	repository(name: "people", owner: "${organisation}") {
		object(expression: "master:users.txt") {
			... on Blob {
				text
			}
		}
	}
}`;
	let response;
	try {
		response = await makeRequest(client, query);
	} catch (error) {
		logger.error({ error }, 'An error occured getting the people list');
		throw error;
	}
	if (!has(response.body, 'data.repository.object.text')) {
		logger.error(
			{
				statusCode: response.statusCode,
				body: response.body,
			},
			'The people file request returned with an unexpected data format',
		);
		throw new Error('Github people file response error');
	}

	logger.debug(
		{
			event: 'GITHUB_FT_PEOPLE_RESPONSE',
			contents: response.body.data.repository.object.text,
		},
		'Received FT people.txt file',
	);
	return response.body.data.repository.object.text
		.split('\n')
		.map(line => line.trim().split(/\s+/))
		.reduce((result, [user, ...ftUser]) => {
			result[user.toLowerCase()] = ftUser.join(' ');
			return result;
		}, {});
};

const fetchUsers = async ({ cursor, client, organisation }) => {
	let response;
	let body;
	try {
		response = await makeRequest(
			client,
			getUsersQuery({ cursor, first: USERS_PAGE_SIZE, organisation }),
		);
		({ body } = response);
	} catch (error) {
		if (has(error, 'body')) {
			logger.error(
				{
					errors:
						(error.body && error.body.errors) ||
						error.body ||
						error.message,
					statusCode: error.statusCode,
				},
				'The response returned with errors',
			);
			throw new Error('Github response error');
		}
		logger.error({ error }, 'An error occured');
		throw error;
	}
	if (!has(body, 'data.organization.members')) {
		logger.error(
			{
				body,
				statusCode: response.statusCode,
			},
			'The response returned with an unexpected data format',
		);
		throw new Error('Github response error');
	}
	const {
		nodes,
		totalCount,
		pageInfo: { endCursor, hasNextPage },
	} = body.data.organization.members;
	return {
		nodes,
		totalCount,
		endCursor,
		hasNextPage,
	};
};

const enrichUsersWithPeopleData = (users, people) => {
	return users.map(user =>
		Object.assign({}, user, {
			ftUsername: people[user.login.toLowerCase()],
		}),
	);
};

const getUsers = async ({
	organisation,
	githubAccessToken,
	onProgress,
	useFtPeople,
}) => {
	const graphqlClient = getGithubGraphQlClient(githubAccessToken);
	let fetchedCount = 0;

	const iterate = async cursor => {
		const { nodes, totalCount, endCursor, hasNextPage } = await fetchUsers({
			client: graphqlClient,
			cursor,
			organisation,
		});
		fetchedCount += nodes.length;
		if (typeof onProgress === 'function') {
			onProgress(totalCount, fetchedCount);
		}

		logger.debug(
			{ event: 'GITHUB_USERS_RESPONSE', users: nodes },
			'Received github users',
		);

		const users = nodes.map(node => ({
			name: node.name || '',
			login: node.login,
			email: node.email,
			publicRepositoryContributionCount:
				node.publicRepositoriesContributedTo.totalCount,
			privateRepositoryContributionCount:
				node.privateRepositoriesContributedTo.totalCount,
		}));
		return hasNextPage ? [...users, ...(await iterate(endCursor))] : users;
	};
	try {
		const peoplePromise = useFtPeople
			? getPeople({ client: graphqlClient, organisation })
			: Promise.resolve({});
		const [people, users] = await Promise.all([peoplePromise, iterate()]);
		return useFtPeople ? enrichUsersWithPeopleData(users, people) : users;
	} catch (error) {
		throw error;
	}
};

module.exports = getUsers;
