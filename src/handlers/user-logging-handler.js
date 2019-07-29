'use strict';

const logger = require('@financial-times/lambda-logger');
const getUsers = require('../get-users');
const splunkFormatter = require('../formatters/splunk');

let previousRequestId;

const handler = async (event, context) => {
	if (!previousRequestId) {
		previousRequestId = context.AwsRequestId;
	}
	if (previousRequestId === context.AwsRequestId) {
		logger.info(
			{ event: 'SKIPPED_RETRY', requestId: previousRequestId },
			'Skipping retry to avoid Github rate limit.',
		);
		return {
			message: 'Skipping retry to avoid Github rate limit.',
			requestId: previousRequestId,
		};
	}
	logger.info(
		{ event: 'USER_LOGGING_HANDLER_START' },
		'User logging handler started',
	);
	const { GITHUB_ORGANISATION, GITHUB_ACCESS_TOKEN } = process.env;

	try {
		const users = await getUsers({
			organisation: GITHUB_ORGANISATION,
			githubAccessToken: GITHUB_ACCESS_TOKEN,
			useFtPeople: true,
		});

		splunkFormatter(users);
		logger.info(
			{ event: 'USER_LOGGING_HANDLER_COMPLETE' },
			'User logging handler completed',
		);
	} catch (error) {
		logger.error(
			{ error, event: 'USER_LOGGING_HANDLER_ERROR' },
			'Failure running the user logging handler',
		);
		throw error;
	}
};

module.exports = { handler };
