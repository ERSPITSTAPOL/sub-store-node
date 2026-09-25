const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

const objectHasOwnPolyfill = require.resolve('core-js/actual/object/has-own');

function patchSubmodule() {
    const openApiPath = path.resolve('src/sub/backend/src/vendor/open-api.js');
    if (fs.existsSync(openApiPath)) {
        let src = fs.readFileSync(openApiPath, 'utf8');

        src = src.replace(
            /const\s+isNode\s*=\s*eval\([^)]+\)\s*;/,
            'const isNode = false;'
        );

        fs.writeFileSync(openApiPath, src);
        console.log('✔️ 已修补: open-api.js');
    } else {
        console.warn('⚠️ 未找到: open-api.js，跳过修补');
    }
}

const shimPlugin = {
    name: 'shim',
    setup(build) {
        const pkgShims = [
            'fastestsmallesttextencoderdecoder',
            'dns-packet',
            'jsrsasign',
            'age-encryption',
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

!(async () => {
    patchSubmodule();

    const pkg = JSON.parse(await fs.promises.readFile('./src/sub/backend/package.json', 'utf8'));
    const version = pkg.version;
    const mainVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version.trim();
    const dist = 'dist/_worker.js';
    const artifacts = [{ src: 'src/worker.js', dest: dist }];

    for await (const artifact of artifacts) {
        await build({
            entryPoints: [artifact.src],
            bundle: true,
            minify: true,
            sourcemap: false,
            platform: 'browser',
            format: 'esm',
            outfile: artifact.dest,
            external: [
                'fs',
                'net',
                'tls',
                'dgram',
                'child_process',
                'stream/promises',
                'stream',
                'buffer'
            ],
            inject: [objectHasOwnPolyfill],
            define: {
                __VERSION__: `"${version}"`,
            },
            plugins: [shimPlugin],
        });

        fs.writeFileSync(
            path.join(__dirname, dist),
            `// SUB_STORE_NODE_VERSION: ${mainVersion}
${fs.readFileSync(path.join(__dirname, dist), {
    encoding: 'utf8',
})}`,
            {
                encoding: 'utf8',
            },
        );
        console.log(`✔️ 打包完成: ${artifact.src} → ${artifact.dest}`);
    }
})()
    .catch((e) => {
        console.log(e);
    })
    .finally(() => {
        console.log('done');
    });