import jsPlugin from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = {
	ignores: ['examples/**', '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.d.ts', '**/*.tsbuildinfo']
};

const imports = {
	plugins: {
		'simple-import-sort': simpleImportSortPlugin
	},
	rules: {
		'simple-import-sort/imports': 'error',
		'simple-import-sort/exports': 'error'
	}
};

const commonRules = {
	eqeqeq: ['error', 'always'],
	'no-console': 'error',
	'no-alert': 'error',
	'no-debugger': 'error',
	'no-var': 'error',
	'prefer-const': 'error',
	curly: ['error', 'multi-or-nest', 'consistent']
};

const cleanCodeRules = {
	complexity: ['error', 10],
	'max-depth': ['error', 3],
	'max-nested-callbacks': ['error', 3],
	'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
	'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
	'max-statements': ['error', 15],
	'no-nested-ternary': 'error',
	'no-else-return': ['error', { allowElseIf: false }],
	'no-lonely-if': 'error',
	'no-useless-return': 'error',
	'no-implicit-coercion': 'error',
	'no-param-reassign': ['error', { props: true }],
	'object-shorthand': 'error',
	'prefer-template': 'error',
	'prefer-object-has-own': 'error'
};

const js = {
	files: ['**/*.{js,mjs,cjs}'],
	...jsPlugin.configs.recommended,
	languageOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		globals: { ...globals.node }
	},
	rules: {
		...jsPlugin.configs.recommended.rules,
		...commonRules,
		...cleanCodeRules,
		'max-params': ['error', 4],
		'no-return-await': 'error',
		'no-shadow': 'error'
	}
};

const ts = [
	...[...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map((config) => ({
		...config,
		files: ['**/*.ts']
	})),
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			...commonRules,
			...cleanCodeRules,
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/restrict-template-expressions': 'error',
			'@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
			'no-shadow': 'off',
			'@typescript-eslint/no-shadow': 'error',
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ prefer: 'type-imports', fixStyle: 'separate-type-imports' }
			],
			'@typescript-eslint/consistent-type-exports': 'error',
			'@typescript-eslint/explicit-function-return-type': [
				'error',
				{ allowExpressions: true, allowTypedFunctionExpressions: true }
			],
			'@typescript-eslint/explicit-module-boundary-types': 'error',
			'@typescript-eslint/strict-boolean-expressions': [
				'error',
				{ allowString: false, allowNumber: false, allowNullableObject: true }
			],
			'@typescript-eslint/switch-exhaustiveness-check': 'error',
			'@typescript-eslint/prefer-readonly': 'error',
			'@typescript-eslint/no-import-type-side-effects': 'error',
			'@typescript-eslint/max-params': ['error', { max: 4 }]
		}
	}
];

const tests = {
	files: ['**/tests/**/*.test.mjs'],
	rules: {
		'max-lines-per-function': 'off',
		'max-nested-callbacks': ['error', 4]
	}
};

const tooling = {
	files: ['scripts/**/*.mjs'],
	rules: {
		'no-console': 'off'
	}
};

export default [ignores, imports, js, ...ts, tests, tooling, prettierConfig];
