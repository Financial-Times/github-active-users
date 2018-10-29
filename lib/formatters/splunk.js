'use strict';

const logger = require('@financial-times/lambda-logger');

const format = users => {
	const usersWithTotals = users.map(user =>
		Object.assign({}, user, {
			totalContributionCount:
				user.publicRepositoryContributionCount +
				user.privateRepositoryContributionCount,
		}),
	);
	usersWithTotals.forEach(user => {
		logger.info(
			Object.assign({ event: 'GITHUB_USER_CONTRIBUTIONS', user }),
		);
	});
};

module.exports = format;
