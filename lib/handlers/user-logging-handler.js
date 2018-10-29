'use strict';

const logger = require('@financial-times/lambda-logger');
const getUsers = require('../get-users');
const splunkFormatter = require('../formatters/splunk');

const handler = async () => {
	logger.info('Starting...');
	const { GITHUB_ORGANISATION, GITHUB_ACCESS_TOKEN } = process.env;

	try {
		const users = await getUsers({
			organisation: GITHUB_ORGANISATION,
			githubAccessToken: GITHUB_ACCESS_TOKEN,
			useFtPeople: true,
		});

		splunkFormatter(users);
	} catch (error) {
		logger.error(error);
		throw error;
	}
};

module.exports = { handler };
