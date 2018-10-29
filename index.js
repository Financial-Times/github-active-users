#!/usr/bin/env node

'use strict';

const has = require('lodash.has');
const got = require('got');
const https = require('https');
const ora = require('ora');
const yargs = require('yargs');
require('console.table');

const { argv } = yargs
	.usage('Usage: $0 [options]')
	.example(
		'$0 -k [github-api-key] -o Financial-Times -p false',
		'prints organisation github users with the recent repository contribution counts',
	)
	.boolean('people')
	.alias('k', 'api-key')
	.alias('o', 'organisation')
	.alias('p', 'people')
	.default('o', 'Financial-Times')
	.default('p', true)
	.describe('k', 'the github API key to use for Github GraphQL requests')
	.describe('o', 'the github organisation to lookup')
	.describe(
		'p',
		'whether to cross reference with the Financial-Times people repository',
	)
	.demandOption(['k'])
	.help('h')
	.alias('h', 'help');

const ORGANISATION = argv.o;
const GITHUB_PERSONAL_ACCESS_TOKEN = argv.k;
const USE_FT_PEOPLE_REPOSITORY = argv.p;

// We only care about the total so the lowest page size will work
const REPOSITORIES_PAGE_SIZE = 1;
// Queries are fairly slow with large results. Setting this too large busts the github API and results in 502s
const USERS_PAGE_SIZE = 10;

const getUsersQuery = ({ cursor, first }) => {
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
	organization(login: "${ORGANISATION}") {
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

const setProgress = spinner => (total = '?', progress) => {
	spinner.text = `Fetched page ${progress}/${total}`;
};

const logTable = (title, headings, data) => {
	console.log(title);
	console.table(
		headings,
		data.reduce((table, entry) => {
			const row = headings.map(heading => entry[heading]);
			return [...table, row];
		}, []),
	);
};

const formatResultsConsole = (users, people) => {
	const usersWithUsernames = users.map(user =>
		Object.assign({}, user, {
			ftUsername: USE_FT_PEOPLE_REPOSITORY
				? people[user.login.toLowerCase()]
				: undefined,
			totalContributionCount:
				user.publicRepositoryContributionCount +
				user.privateRepositoryContributionCount,
		}),
	);
	const [
		contributingUsers,
		nonPrivateRepositoryContributingUsers,
	] = usersWithUsernames.reduce(
		(result, user) => {
			const [contributingResult, nonContributingResult] = result;
			const hasContributions =
				user.privateRepositoryContributionCount !== 0;
			(hasContributions
				? contributingResult
				: nonContributingResult
			).push(user);
			return result;
		},
		[[], []],
	);
	const compareLogin = (a, b) => a.login.localeCompare(b.login);
	const sortedContributingUsersDescendingByContributions = contributingUsers.sort(
		(a, b) => {
			if (a.totalContributionCount > b.totalContributionCount) {
				return -1;
			}
			if (a.totalContributionCount < b.totalContributionCount) {
				return 1;
			}
			return compareLogin(a, b);
		},
	);
	const sortedNonPrivateContributingUsersByLogin = nonPrivateRepositoryContributingUsers.sort(
		compareLogin,
	);

	logTable(
		`${
			sortedContributingUsersDescendingByContributions.length
		} contributing users fetched`,
		[
			'name',
			'login',
			USE_FT_PEOPLE_REPOSITORY ? 'ftUsername' : '',
			'email',
			'publicRepositoryContributionCount',
			'privateRepositoryContributionCount',
			'totalContributionCount',
		].filter(x => x),
		sortedContributingUsersDescendingByContributions,
	);
	logTable(
		`${
			sortedNonPrivateContributingUsersByLogin.length
		} users with no contributions fetched`,
		[
			'name',
			'login',
			USE_FT_PEOPLE_REPOSITORY ? 'ftUsername' : '',
			'email',
			'publicRepositoryContributionCount',
		].filter(x => x),
		sortedNonPrivateContributingUsersByLogin,
	);
};

const githubGraphQlClient = got.extend({
	baseUrl: 'https://api.github.com',
	headers: {
		'Content-Type': 'application/json',
		Authorization: `bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
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

const makeRequest = query => {
	return githubGraphQlClient.post('/graphql', {
		body: {
			query,
		},
	});
};

const getPeople = async () => {
	const query = `{
	repository(name: "people", owner: "${ORGANISATION}") {
		object(expression: "master:users.txt") {
			... on Blob {
				text
			}
		}
	}
}`;
	let response;
	try {
		response = await makeRequest(query);
	} catch (error) {
		console.error('An error occured getting the people list', error);
		throw error;
	}
	if (!has(response.body, 'data.repository.object.text')) {
		console.error(
			'The people file request returned with an unexpected data format',
			{
				statusCode: response.statusCode,
				body: JSON.stringify(response.body),
			},
		);
		throw new Error('Github people file response error');
	}
	return response.body.data.repository.object.text
		.split('\n')
		.map(line => line.trim().split(/\s+/))
		.reduce((result, [user, ...ftUser]) => {
			result[user.toLowerCase()] = ftUser.join(' ');
			return result;
		}, {});
};

const getUsers = async cursor => {
	let response;
	let body;
	try {
		response = await makeRequest(
			getUsersQuery({ cursor, first: USERS_PAGE_SIZE }),
		);
		({ body } = response);
	} catch (error) {
		if (has(error, 'body')) {
			console.error('The response returned with errors', {
				errors: JSON.stringify(
					(error.body && error.body.errors) ||
						error.body ||
						error.message,
				),
				statusCode: error.statusCode,
			});
			throw new Error('Github response error');
		}
		console.error('An error occured', error);
		throw error;
	}
	if (!has(body, 'data.organization.members')) {
		console.error('The response returned with an unexpected data format', {
			statusCode: response.statusCode,
			body: JSON.stringify(body),
		});
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

(async function start() {
	let fetchedCount = 0;
	console.error('Starting...');
	const spinner = ora('Fetching users...').start();
	const updateProgress = setProgress(spinner);

	const iterate = async cursor => {
		const { nodes, totalCount, endCursor, hasNextPage } = await getUsers(
			cursor,
		);
		fetchedCount += nodes.length;
		updateProgress(totalCount, fetchedCount);

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
		const peoplePromise = USE_FT_PEOPLE_REPOSITORY
			? getPeople()
			: Promise.resolve({});
		const [people, users] = await Promise.all([peoplePromise, iterate()]);

		spinner.succeed('Done!');
		formatResultsConsole(users, people);
	} catch (error) {
		spinner.fail(`An error occured: ${error.stack}`);
		process.exit(1);
	}
})();
