import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

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
      try {
        // Resolve the path to the python script in the parent directory
        // Note: Depending on your Vercel project root settings, you may need to ensure 
        // the python script is included in the serverless function build.
        const scriptPath = path.resolve(process.cwd(), '../build-fonts-v2.py');
        
        // Execute the python script with the provided arguments
        // You may need to adjust the argument format to exactly match what build-fonts-v2.py expects
        const { stdout, stderr } = await execAsync(`python "${scriptPath}" "${title}" "${content}"`);
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Successfully executed Python script.\n\nStdout:\n${stdout}\n\nStderr:\n${stderr}`
          }] 
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: 'text', 
            text: `Failed to execute python script:\n${error.message}` 
          }],
          isError: true
        };
      }
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
        content: [{ type: 'text', text: 'PosterForge MCP server is active and connected to Python scripts.' }] 
      };
    }
  );
});

export const POST = handler;