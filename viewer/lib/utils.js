function safeRequire (path) {
  try {
    return require(path)
  } catch (e) {
    return {}
  }
}
const { loadImage, createCanvas } = safeRequire('node-canvas-webgl/lib')
const THREE = require('three')
const path = require('path')
const fs = require('fs')

const textureCache = {}
const assetsRoot = process.env.PRISMARINE_VIEWER_ASSETS || ''
const fallbackVersion = process.env.PRISMARINE_VIEWER_FALLBACK_VERSION || ''

function pickEntityTextureFallback (root, relativePath) {
  const match = relativePath.match(/^textures\/([^/]+)\/entity\/([^/]+)\.png$/)
  if (!match) return null
  const version = match[1]
  const name = match[2]
  const dirPath = path.resolve(root, `textures/${version}/entity/${name}`)
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null
  const entries = fs.readdirSync(dirPath).filter(file => file.endsWith('.png')).sort()
  if (entries.length === 0) return null
  const preferred = [
    `${name}.png`,
    `temperate_${name}.png`,
    `default.png`
  ].find(candidate => entries.includes(candidate))
  const fileName = preferred || entries[0]
  return path.join(dirPath, fileName)
}

function resolveEntityTextureFallback (relativePath) {
  const roots = [path.resolve(__dirname, '../../public')]
  if (assetsRoot) roots.push(path.resolve(assetsRoot))
  for (const root of roots) {
    const resolved = pickEntityTextureFallback(root, relativePath)
    if (resolved) return resolved
  }
  return null
}

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
  const entityFallback = resolveEntityTextureFallback(relativePath)
  if (entityFallback) return entityFallback
  return localPath
}

function loadImageSafe (filePath) {
  try {
    return Promise.resolve(loadImage(filePath))
  } catch (err) {
    return Promise.reject(err)
  }
}

// todo not ideal, export different functions for browser and node
function loadTexture (texture, cb) {
  if (process.platform === 'browser') {
    return require('./utils.web').loadTexture(texture, cb)
  }

  if (textureCache[texture]) {
    cb(textureCache[texture])
  } else {
    const resolved = resolveAssetPath(texture)
    const missingPath = path.resolve(__dirname, 'missing_texture.png')
    loadImageSafe(resolved)
      .catch(() => {
        const fallback = resolveEntityTextureFallback(texture)
        if (fallback && fallback !== resolved) {
          return loadImageSafe(fallback)
        }
        return loadImageSafe(missingPath)
      })
      .then(image => {
        let tex = null
        if (image && createCanvas) {
          const canvas = createCanvas(image.width, image.height)
          const ctx = canvas.getContext('2d')
          ctx.drawImage(image, 0, 0)
          tex = new THREE.CanvasTexture(canvas)
          tex.needsUpdate = true
        }
        if (!tex) {
          tex = new THREE.CanvasTexture(image)
          tex.needsUpdate = true
        }
        textureCache[texture] = tex
        cb(tex)
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
