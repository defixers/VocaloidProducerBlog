import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'

const imageDir = join(process.cwd(), 'public', 'images')
const files = (await readdir(imageDir)).filter((file) => file.endsWith('.jpg'))

for (const file of files) {
  const input = join(imageDir, file)
  const name = basename(file, '.jpg')

  await Promise.all([
    sharp(input, { failOn: 'none' })
      .resize({ width: 640, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toFile(join(imageDir, `${name}-640.webp`)),
    sharp(input, { failOn: 'none' })
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toFile(join(imageDir, `${name}-1600.webp`)),
  ])
}

console.log(`Optimized ${files.length} images.`)
