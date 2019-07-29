'use strict';

const logger = require('@financial-times/lambda-logger');
const pThrottle = require('p-throttle');
const has = require('lodash.has');
const got = require('got');
const https = require('https');

// Queries are fairly slow with large results. Setting this too large busts the github API and results in 502s
const USERS_PAGE_SIZE = 5;

const USER_PUBLIC_REPOSITORIES_PAGE_SIZE = 50;

const getRepositoryQuery = ({ cursor, privacy, pageSize = 1 }) => {
	const repositoriesQuery = [
		`first: ${pageSize}`,
		`includeUserRepositories: false`,
		`privacy: ${privacy}`,
		cursor && `after: "${cursor}"`,
	]
		.filter(x => x)
		.join(', ');

	return `repositoriesContributedTo(${repositoriesQuery}) {
		totalCount
		pageInfo {
			hasNextPage
			endCursor
		}
		nodes {
			nameWithOwner
		}
	}`;
};

const getUsersQuery = ({ cursor, first, organisation }) => {
	const membersQueryList = [];
	if (first) {
		membersQueryList.push(`first: ${first}`);
	}
	if (cursor) {
		membersQueryList.push(`after: "${cursor}"`);
	}
	const membersQuery = membersQueryList.join(', ');

	return `{
	organization(login: "${organisation}") {
		membersWithRole(${membersQuery}) {
			nodes {
				login
				name
				email
				publicRepositoriesContributedTo: ${getRepositoryQuery({
					privacy: 'PUBLIC',
					pageSize: 100,
				})}
				privateRepositoriesContributedTo: ${getRepositoryQuery({
					privacy: 'PRIVATE',
					pageSize: 1,
				})}
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
			statusCodes: [403, 502],
			maxRetryAfter: 70,
		},
		hooks: {
			beforeRetry: [
				(options, error, retryCount) => {
					logger.warn(
						{
							event: 'GITHUB_REQUEST_RETRY',
							error:
								(error.response && error.response.body) ||
								error,
							retryCount,
							body: options.body,
						},
						'Request failed, retrying',
					);
				},
			],
		},
		agent: {
			https: new https.Agent({ keepAlive: true }),
		},
	});

const onePerSecond = func => pThrottle(func, 1, 1000);

const makeRequest = onePerSecond(async (client, query) => {
	let response;
	try {
		response = await client.post('/graphql', {
			body: {
				query,
			},
		});
	} catch (error) {
		if (has(error, 'response')) {
			logger.error(
				{
					errors:
						(error.response.body && error.response.body.errors) ||
						error.response.body ||
						error.message,
					statusCode: error.statusCode,
				},
				'The response returned with errors',
			);
			throw new Error('Github response error');
		}
		logger.error({ error, query }, 'An error occured');
		throw error;
	}

	return response;
});

const getUserPublicRepositories = async ({ login, startCursor, client }) => {
	const iterate = async cursor => {
		const response = await makeRequest(
			client,
			`{
				user(login:"${login}") {
					repositoriesContributedTo: ${getRepositoryQuery({
						privacy: 'PUBLIC',
						pageSize: USER_PUBLIC_REPOSITORIES_PAGE_SIZE,
						cursor,
					})}
				}
			}`,
		);
		const { body } = response;
		if (!has(body, 'data.user.repositoriesContributedTo')) {
			logger.error(
				{
					body,
					statusCode: response.statusCode,
				},
				'The response returned with an unexpected data format',
			);
			throw new Error('Github response error');
		}

		logger.debug(
			{
				event: 'GITHUB_USER_RESPONSE',
				contents: response.body.data.user,
			},
			'Received github user',
		);

		const {
			nodes,
			pageInfo: { endCursor, hasNextPage },
		} = body.data.user.repositoriesContributedTo;

		return hasNextPage ? [...nodes, ...(await iterate(endCursor))] : nodes;
	};
	return iterate(startCursor);
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
	const response = await makeRequest(
		client,
		getUsersQuery({ cursor, first: USERS_PAGE_SIZE, organisation }),
	);
	const { body } = response;
	if (!has(body, 'data.organization.membersWithRole')) {
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
	} = body.data.organization.membersWithRole;
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

		const users = await Promise.all(
			nodes.map(async node => {
				const { publicRepositoriesContributedTo } = node;
				if (publicRepositoriesContributedTo.pageInfo.hasNextPage) {
					logger.debug(
						{
							event: 'USER_EXTRA_PUBLIC_REPOSITORIES',
							login: node.login,
							totalCount:
								node.publicRepositoriesContributedTo.totalCount,
						},
						'Fetching additional public repositories for user as they exceed the maximum page size',
					);
					publicRepositoriesContributedTo.nodes = [
						...publicRepositoriesContributedTo.nodes,
						...(await getUserPublicRepositories({
							login: node.login,
							client: graphqlClient,
							startCursor:
								publicRepositoriesContributedTo.pageInfo
									.endCursor,
						})),
					];
				}
				const publicRepositoryCount = node.publicRepositoriesContributedTo.nodes.filter(
					({ nameWithOwner }) =>
						nameWithOwner.startsWith(`${organisation}/`),
				).length;
				return {
					name: node.name || '',
					login: node.login,
					email: node.email,
					publicRepositoryContributionCount: publicRepositoryCount,
					privateRepositoryContributionCount:
						node.privateRepositoriesContributedTo.totalCount,
				};
			}),
		);
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
