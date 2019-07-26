'use strict';

/* eslint-disable no-console */

const cTable = require('console.table');

const logTable = (title, headings, data) => {
	console.log(title);
	console.log(
		cTable.getTable(
			headings,
			data.reduce((table, entry) => {
				const row = headings.map(heading => entry[heading]);
				return [...table, row];
			}, []),
		),
	);
};

const format = users => {
	const usersWithTotals = users.map(user =>
		Object.assign({}, user, {
			totalContributionCount:
				user.publicRepositoryContributionCount +
				user.privateRepositoryContributionCount,
		}),
	);

	const hasFtUsernames = usersWithTotals.some(
		({ ftUsername }) => typeof ftUsername !== 'undefined',
	);

	const [
		contributingUsers,
		nonPrivateRepositoryContributingUsers,
	] = usersWithTotals.reduce(
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
		`${sortedContributingUsersDescendingByContributions.length} contributing users fetched`,
		[
			'name',
			'login',
			hasFtUsernames ? 'ftUsername' : '',
			'email',
			'publicRepositoryContributionCount',
			'privateRepositoryContributionCount',
			'totalContributionCount',
		].filter(x => x),
		sortedContributingUsersDescendingByContributions,
	);
	logTable(
		`${sortedNonPrivateContributingUsersByLogin.length} users with no contributions fetched`,
		[
			'name',
			'login',
			hasFtUsernames ? 'ftUsername' : '',
			'email',
			'publicRepositoryContributionCount',
		].filter(x => x),
		sortedNonPrivateContributingUsersByLogin,
	);
};

module.exports = format;
