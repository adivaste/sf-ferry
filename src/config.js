import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_API_VERSION = '62.0';

/**
 * Resolve the default Salesforce package directory from sfdx-project.json
 * (falls back to "force-app"), and the API version (sourceApiVersion or default).
 */
export function resolveProject(cwd = process.cwd()) {
  const projectFile = path.join(cwd, 'sfdx-project.json');
  let sourceDir = 'force-app';
  let apiVersion = DEFAULT_API_VERSION;

  if (existsSync(projectFile)) {
    try {
      const project = JSON.parse(readFileSync(projectFile, 'utf8'));
      const defaultPkg = (project.packageDirectories || []).find((p) => p.default)
        || (project.packageDirectories || [])[0];
      if (defaultPkg?.path) sourceDir = defaultPkg.path;
      if (project.sourceApiVersion) apiVersion = project.sourceApiVersion;
    } catch {
      // ignore malformed project file, use defaults
    }
  }

  return {
    sourceDir: path.resolve(cwd, sourceDir),
    apiVersion,
    isSfdxProject: existsSync(projectFile),
  };
}
