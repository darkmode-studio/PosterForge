import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const handler = createMcpHandler((server) => {
  server.registerTool(
    'generate_poster',
    {
      description: 'Generate a text poster using PosterForge Python scripts',
      inputSchema: z.object({
        title: z.string().describe('Title of the poster'),
        content: z.string().describe('Main content of the poster')
      }),
    },
    async ({ title, content }) => {
      // In a full implementation, you can call the python scripts here via child_process
      // or HTTP requests depending on where they run.
      return { 
        content: [{ 
          type: 'text', 
          text: `Successfully triggered poster generation for "${title}".\n\nContent:\n${content}`
        }] 
      };
    }
  );
  
  server.registerTool(
    'get_repository_status',
    {
      description: 'Check the status of the PosterForge repository',
      inputSchema: z.object({}),
    },
    async () => {
      return { 
        content: [{ type: 'text', text: 'PosterForge MCP server is active and ready.' }] 
      };
    }
  );
});

export const POST = handler;