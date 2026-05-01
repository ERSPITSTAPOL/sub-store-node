import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function patchSubmodule() {
    const openApiPath = resolve('src/sub/backend/src/vendor/open-api.js');
    let src = readFileSync(openApiPath, 'utf8');

    src = src.replace(
        /const isNode\s*=\s*eval\([^)]+\);/,
        'const isNode = false;'
    );

    writeFileSync(openApiPath, src);
    console.log('✔️ 已修补: open-api.js');
}

const shimPlugin = {
    name: 'shim',
    setup(build) {
        const pkgShims = [
            'fastestsmallesttextencoderdecoder',
            'dns-packet',
            'jsrsasign',
        ];
        for (const pkg of pkgShims) {
            build.onResolve({ filter: new RegExp(`^${pkg}$`) }, () => ({
                path: pkg,
                namespace: 'empty-shim',
            }));
        }
        build.onLoad({ filter: /.*/, namespace: 'empty-shim' }, () => ({
            contents: 'export default {}',
            loader: 'js',
        }));
    },
};

const artifacts = [{ src: 'index.js', dest: 'dist/_worker.js' }];

(async () => {
    patchSubmodule();

    for (const artifact of artifacts) {
        await esbuild.build({
            entryPoints: [artifact.src],
            bundle: true,
            outfile: artifact.dest,
            sourcemap: true,
            minify: true,
            target: ['es2022'],
            format: 'esm',
            platform: 'browser',
            logLevel: 'error',
            plugins: [shimPlugin],
            external: ['buffer'],
        });
        console.log(`✔️ 打包完成: ${artifact.src} → ${artifact.dest}`);
    }
})();