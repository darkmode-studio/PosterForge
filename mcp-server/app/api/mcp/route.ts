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
        // Adjust the path to where the python script exists relative to Next.js root
        const scriptPath = path.resolve(process.cwd(), '../build-fonts-v2.py');
        
        // Execute the python script
        const { stdout, stderr } = await execAsync(`python3 "${scriptPath}" "${title}" "${content}"`);
        
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
        content: [{ type: 'text', text: 'PosterForge MCP server is active, stable, and ready.' }] 
      };
    }
  );
});

// For Next.js App Router, we export GET and POST
export { handler as GET, handler as POST };