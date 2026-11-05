## @chartguard/eslint-plugin

### default
plugin: Plugin
// uses Plugin
interface Plugin extends ESLint.Plugin {
    readonly meta: typeof meta;
    readonly rules: typeof rules;
    readonly configs: {
        readonly recommended: Linter.Config;
    };
}

### meta
meta: {
    name: string;
    version: string;
}

### rules
rules: {
    'valid-config': Rule.RuleModule;
    'config-warnings': Rule.RuleModule;
    'chart-quality': Rule.RuleModule;
}
