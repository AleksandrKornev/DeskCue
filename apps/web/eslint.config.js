import js from "@eslint/js";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const testTypescriptFiles = [
  "e2e/**/*.ts",
  "playwright.config.ts"
];

const typescriptFiles = [
  "src/**/*.{ts,tsx}",
  "vite.chunks.ts",
  "vite.config.ts",
  "vite.embed.config.ts",
  "vitest.config.ts",
  ...testTypescriptFiles
];

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript
    ],
    files: typescriptFiles,
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          project: "./tsconfig.json"
        }
      }
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "import-x/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "import-x/no-cycle": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-named-as-default": "off",
      "import-x/no-named-as-default-member": "off",
      "import-x/order": [
        "error",
        {
          alphabetize: {
            order: "asc",
            caseInsensitive: true
          },
          distinctGroup: false,
          groups: [
            ["builtin", "external"],
            "internal",
            ["parent", "sibling", "index"]
          ],
          "newlines-between": "always",
          pathGroups: [
            {
              pattern: "@deskcue/**",
              group: "internal",
              position: "before"
            },
            {
              pattern: "@{api,assets,components,lib,models,modules,pages}/**",
              group: "internal"
            }
          ],
          pathGroupsExcludedImportTypes: ["builtin"]
        }
      ],
      "import-x/no-unresolved": [
        "error",
        {
          ignore: ["\\.module\\.scss$"]
        }
      ],
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-use-before-define": [
        "error",
        {
          allowNamedExports: false,
          classes: true,
          enums: true,
          functions: true,
          ignoreTypeReferences: true,
          typedefs: false,
          variables: true
        }
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
            properties: false
          }
        }
      ],
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message: "Use the configured web aliases for cross-folder imports."
            }
          ]
        }
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  },
  {
    files: ["vite.chunks.ts", "vite.config.ts", "vite.embed.config.ts", "vitest.config.ts"],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: testTypescriptFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        project: "./tsconfig.test.json",
        projectService: false,
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          project: "./tsconfig.test.json"
        }
      }
    }
  },
  {
    extends: [js.configs.recommended],
    files: ["scripts/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node
    },
    rules: {
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
      "no-use-before-define": [
        "error",
        {
          classes: true,
          functions: true,
          variables: true
        }
      ]
    }
  }
);
