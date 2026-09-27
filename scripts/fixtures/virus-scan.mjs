import { readFile } from 'node:fs/promises'

const filePath = process.argv.at(-1)
const content = await readFile(filePath)
if (content.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))) process.exitCode = 1
else if (content.includes(Buffer.from('SIMULATED-SCANNER-ERROR'))) process.exitCode = 2
