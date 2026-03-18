const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const PORT_OFFSET = parseInteger(process.env.PORT_OFFSET, 0)

export const resolvePort = (value: string | undefined, basePort: number): number => {
  return parseInteger(value, basePort) + PORT_OFFSET
}

export const toLocalBaseUrl = (port: number): string => `http://localhost:${port}`

export const servicePorts = {
  mainServer: resolvePort(process.env.MAIN_SERVER_PORT, 7070),
  aiServer: resolvePort(process.env.AI_SERVER_PORT, 7081),
  operatorServer: resolvePort(process.env.OPERATOR_SERVER_PORT, 7082),
}
