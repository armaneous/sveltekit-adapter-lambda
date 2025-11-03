import pkg from 'fs-extra';
const { copyFileSync, unlinkSync, existsSync, statSync, mkdirSync, emptyDirSync, readdirSync, writeFileSync } = pkg;
import { join } from 'path/posix';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import * as esbuild from 'esbuild';

// Get the directory path using import.meta.url instead of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @param {{
 *   out?: string;
 *   esbuildOverride?: import('esbuild').BuildOptions;
 * }} options
 */
export default function ({ out = 'build', esbuildOverride = {} } = {}) {
  /** @type {import('@sveltejs/kit').Adapter} */
  const adapter = {
    name: 'adapter-serverless',

    async adapt(builder) {
      emptyDirSync(out);

      const static_directory = join(out, 'assets');
      if (!existsSync(static_directory)) {
        mkdirSync(static_directory, { recursive: true });
      }

      const prerendered_directory = join(out, 'prerendered');
      if (!existsSync(prerendered_directory)) {
        mkdirSync(prerendered_directory, { recursive: true });
      }

      const server_directory = join(out, 'server');
      if (!existsSync(server_directory)) {
        mkdirSync(server_directory, { recursive: true });
      }

      builder.log.minor('Copying assets');
      builder.writeClient(static_directory);

      builder.log.minor('Copying server');
      builder.writeServer(out);
      copyFileSync(`${__dirname}/files/serverless.js`, `${server_directory}/_serverless.js`);
      copyFileSync(`${__dirname}/files/shims.js`, `${server_directory}/shims.js`);


      builder.log.minor('Building lambda');
      esbuild.buildSync({
        entryPoints: [`${server_directory}/_serverless.js`],
        outfile: `${server_directory}/serverless.js`,
        inject: [join(`${server_directory}/shims.js`)],
        external: ['node:*'],
        format: 'cjs',
        bundle: true,
        platform: 'node',
        ...esbuildOverride
      });

      builder.log.minor('Prerendering static pages');
      await builder.writePrerendered(prerendered_directory);

      builder.log.minor('Cleanup');
      unlinkSync(`${server_directory}/_serverless.js`);
      unlinkSync(`${out}/index.js`);
    },
  };

  return adapter;
}

const getAllFiles = function (dirPath, basePath, arrayOfFiles) {
  const files = readdirSync(dirPath)

  arrayOfFiles = arrayOfFiles || []
  basePath = basePath || dirPath

  files.forEach(function (file) {
    if (statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, basePath, arrayOfFiles)
    } else {
      arrayOfFiles.push(join("/", dirPath.replace(basePath, ''), "/", file))
    }
  })

  return arrayOfFiles
}