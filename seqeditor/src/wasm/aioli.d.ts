declare module '@biowasm/aioli' {
  interface ToolConfig {
    tool: string
    version: string
    program?: string
  }

  interface AioliInstance {
    exec(command: string): Promise<string | { stdout: string; stderr: string }>
    fs(method: string, ...args: any[]): Promise<any>
  }

  class Aioli {
    constructor(tools: ToolConfig[])
    then(resolve: (cli: AioliInstance) => void): void
  }

  export default Aioli
}
