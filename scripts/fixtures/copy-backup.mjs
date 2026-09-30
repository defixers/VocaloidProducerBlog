import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error('source and destination are required')
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
