#!/usr/bin/env node

'use strict';

const logger = require('@financial-times/lambda-logger');
const ora = require('ora');
const yargs = require('yargs');
const getUsers = require('../src/get-users');
const consoleFormatter = require('../src/formatters/console');

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
	.describe(
		'k',
		'the github API key to use for Github GraphQL requests. Requires read:org, read:user, repo scopes',
	)
	.describe('o', 'the github organisation to lookup')
	.describe(
		'p',
		'whether to cross reference with the Financial-Times people repository',
	)
	.demandOption(['k'])
	.help('h')
	.alias('h', 'help');

const {
	o: ORGANISATION,
	k: GITHUB_ACCESS_TOKEN,
	p: USE_FT_PEOPLE_REPOSITORY,
} = argv;

const setProgress = spinner => (total = '?', progress) => {
	spinner.text = `Fetched page ${progress}/${total}`;
};

(async function start() {
	logger.info('Starting...');
	const spinner = ora('Fetching users...').start();

	try {
		const users = await getUsers({
			organisation: ORGANISATION,
			githubAccessToken: GITHUB_ACCESS_TOKEN,
			onProgress: setProgress(spinner),
			useFtPeople: USE_FT_PEOPLE_REPOSITORY,
		});

		spinner.succeed('Done!');
		consoleFormatter(users);
	} catch (error) {
		spinner.fail(`An error occured: ${error.stack}`);
		process.exit(1);
	}
})();
