function safeRequire (path) {
  try {
    return require(path)
  } catch (e) {
    return {}
  }
}
const { loadImage } = safeRequire('node-canvas-webgl/lib')
const THREE = require('three')
const path = require('path')
const fs = require('fs')

const textureCache = {}
const assetsRoot = process.env.PRISMARINE_VIEWER_ASSETS || ''
const fallbackVersion = process.env.PRISMARINE_VIEWER_FALLBACK_VERSION || ''

function withFallbackVersion (relativePath) {
  if (!fallbackVersion) return null
  let match = relativePath.match(/^(textures\/)([^/]+)\.png$/)
  if (match) return `${match[1]}${fallbackVersion}.png`
  match = relativePath.match(/^(textures\/)([^/]+)\/(.+)$/)
  if (match) return `${match[1]}${fallbackVersion}/${match[3]}`
  return null
}

function resolveAssetPath (relativePath) {
  const candidates = []
  const localPath = path.resolve(__dirname, '../../public/' + relativePath)
  candidates.push(localPath)
  if (assetsRoot) {
    candidates.push(path.resolve(assetsRoot, relativePath))
  }
  const fallbackPath = withFallbackVersion(relativePath)
  if (fallbackPath) {
    candidates.push(path.resolve(__dirname, '../../public/' + fallbackPath))
    if (assetsRoot) {
      candidates.push(path.resolve(assetsRoot, fallbackPath))
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return localPath
}

// todo not ideal, export different functions for browser and node
function loadTexture (texture, cb) {
  if (process.platform === 'browser') {
    return require('./utils.web').loadTexture(texture, cb)
  }

  if (textureCache[texture]) {
    cb(textureCache[texture])
  } else {
    loadImage(resolveAssetPath(texture)).then(image => {
      textureCache[texture] = new THREE.CanvasTexture(image)
      cb(textureCache[texture])
    })
  }
}

function loadJSON (json, cb) {
  if (process.platform === 'browser') {
    return require('./utils.web').loadJSON(json, cb)
  }
  cb(require(resolveAssetPath(json)))
}

module.exports = { loadTexture, loadJSON }
