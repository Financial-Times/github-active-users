#!/usr/bin/env node

'use strict';

// Removed context handling in this script as it's a one off-experiment rather than a product
// We should look at making a product context optional
// TODO: Move to shared reliability-engineering executable

/* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
/* eslint-disable no-console */
const shell = require('child_process');
const fetch = require('node-fetch');
const { promisify } = require('util');
const { writeFile } = require('fs');

const exec = promisify(shell.exec);
const write = promisify(writeFile);
const [, , environment, appName] = process.argv;
const { CI = false } = process.env;

const run = command =>
	exec(command).then(({ stdout, stderr }) => {
		if (stderr) {
			throw new Error(stderr);
		}

		return stdout;
	});

const handleFetch = response => {
	if (response.ok) {
		return response.json();
	}
	return response.text().then(text => {
		const err = new Error(text);
		err.status = response.status;
		throw err;
	});
};

const extractDataFromStdout = stdout => JSON.parse(stdout).data;

const authenticateVaultCLI = () => run('vault login --method github');

const authenticateVaultFetch = () =>
	fetch('https://vault.in.ft.com/v1/auth/approle/login', {
		method: 'POST',
		body: JSON.stringify({
			role_id: process.env.VAULT_ROLE_ID,
			secret_id: process.env.VAULT_SECRET_ID,
		}),
	})
		.then(handleFetch)
		.then(json => json.auth.client_token);

const readVaultCLI = (path, env = 'test') =>
	run(
		`vault read -format=json secret/teams/reliability-engineering/${path}/${env}`,
	).then(extractDataFromStdout);

const readVaultFetch = (path, env = 'test', token) =>
	fetch(
		`https://vault.in.ft.com/v1/secret/teams/reliability-engineering/${path}/${env}`,
		{ headers: { 'X-Vault-Token': token } },
	)
		.then(handleFetch)
		.then(json => json.data || {});

const formatVars = object =>
	Object.entries(object)
		.sort(([a], [b]) => {
			return a.toUpperCase().localeCompare(b.toUpperCase());
		})
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');

// eslint-disable-next-line unicorn/no-hex-escape
const wrapRed = (...args) => ['\x1B[31M', ...args, '\x1B[0M'];

const logError = (...args) => console.error(...wrapRed(...args));

const vaultFetch = () =>
	authenticateVaultFetch().then(token => {
		return readVaultFetch(appName, environment, token);
	});

const vaultCLI = () =>
	authenticateVaultCLI().then(() => {
		return readVaultCLI(appName, environment);
	});

console.log(
	`Fetching credentials for .env from Vault.\n\tApplication Name: ${appName}\n\tEnvironment: ${environment}\n\tIs CI?: ${CI}`,
);
(CI ? vaultFetch() : vaultCLI())
	.then(formatVars)
	.then(formattedVars => write('.env', formattedVars))
	.then(() => {
		console.log('Environment variables written to .env');
	})
	.catch(error => {
		console.log('Environment variables failed to write to .env');
		logError(error);
		process.exit(2);
	});
