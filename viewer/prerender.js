const path = require('path')
const { makeTextureAtlas } = require('./lib/atlas')
const { prepareBlocksStates } = require('./lib/modelsBuilder')
const mcAssets = require('minecraft-assets')
const fs = require('fs-extra')

const texturesPath = path.resolve(__dirname, '../public/textures')
if (fs.existsSync(texturesPath) && !process.argv.includes('-f')) {
  console.log('textures folder already exists, skipping...')
  process.exit(0)
}
fs.mkdirSync(texturesPath, { recursive: true })

const blockStatesPath = path.resolve(__dirname, '../public/blocksStates')
fs.mkdirSync(blockStatesPath, { recursive: true })

const supportedVersions = require('./lib/version').supportedVersions
const assetVersions = mcAssets.supportedVersions || []

function pickFallbackVersion (version) {
  if (!assetVersions.length) return version
  if (assetVersions.includes(version)) return version
  const [major, minor] = version.split('.')
  const matches = assetVersions.filter(v => v.startsWith(`${major}.${minor}.`))
  if (matches.length) return matches[matches.length - 1]
  const majorMatches = assetVersions.filter(v => v.startsWith(`${major}.${minor}`))
  if (majorMatches.length) return majorMatches[majorMatches.length - 1]
  return assetVersions[assetVersions.length - 1]
}

for (const version of supportedVersions) {
  let assets
  const fallbackVersion = pickFallbackVersion(version)
  try {
    assets = mcAssets(version)
  } catch (err) {
    console.warn(`minecraft-assets missing ${version}, falling back to ${fallbackVersion}`)
    assets = mcAssets(fallbackVersion)
  }
  const atlas = makeTextureAtlas(assets)
  const out = fs.createWriteStream(path.resolve(texturesPath, version + '.png'))
  const stream = atlas.canvas.pngStream()
  stream.on('data', (chunk) => out.write(chunk))
  stream.on('end', () => console.log('Generated textures/' + version + '.png'))

  const blocksStates = JSON.stringify(prepareBlocksStates(assets, atlas))
  fs.writeFileSync(path.resolve(blockStatesPath, version + '.json'), blocksStates)

  fs.copySync(assets.directory, path.resolve(texturesPath, version), { overwrite: true })
}
