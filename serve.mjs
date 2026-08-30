import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('./apps/editor/', import.meta.url))

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = pathname === '/' ? 'index.html' : pathname.slice(1)
  try {
    const body = await readFile(appDir + file)
    const extension = file.slice(file.lastIndexOf('.'))
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('not found')
  }
})

server.listen(8940, '127.0.0.1', () => {
  console.log('open http://127.0.0.1:8940/ (the orange bar is drawn with coordsAtPos(head, 1))')
})
