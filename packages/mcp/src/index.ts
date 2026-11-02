import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FlowboardClient } from './client.ts';

const client = new FlowboardClient();

const server = new McpServer({
  name: 'flowboard-mcp',
  version: '0.1.0',
});

// Tool 1: List Projects
server.tool(
  'flowboard_list_projects',
  'List accessible Flowboard projects for the authenticated token.',
  {},
  async () => {
    try {
      const projects = await client.listProjects();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list projects: ${err.message}` }],
      };
    }
  },
);

// Tool 2: List Boards in a Project
server.tool(
  'flowboard_list_boards',
  'List active boards inside a specific Flowboard project.',
  {
    projectId: z.string().describe('The ID of the Flowboard project (e.g., "proj_123")'),
  },
  async ({ projectId }) => {
    try {
      const boards = await client.listBoards(projectId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(boards, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list boards for project ${projectId}: ${err.message}` }],
      };
    }
  },
);

// Tool 3: Get Board Columns and Details
server.tool(
  'flowboard_get_board_columns',
  'Get the columns (e.g. Backlog, To Do, In Progress, Done) and details for a given board.',
  {
    boardId: z.string().describe('The ID of the board (e.g., "board_123")'),
  },
  async ({ boardId }) => {
    try {
      const board = await client.getBoard(boardId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(board, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to get board columns for board ${boardId}: ${err.message}` }],
      };
    }
  },
);

// Tool 4: Create a Card
server.tool(
  'flowboard_create_card',
  'Create a new card on a Flowboard board. Accepts column name (e.g. "To Do", "In Progress") or column ID.',
  {
    boardId: z.string().describe('The ID of the board to add the card to'),
    column: z.string().describe('The name of the target column (e.g. "To Do", "In Progress") or the column ID'),
    title: z.string().trim().min(1).max(200).describe('The concise title of the card (1-200 chars)'),
    description: z.string().optional().describe('Optional markdown body or details for the card'),
    priority: z
      .enum(['none', 'low', 'medium', 'high', 'urgent'])
      .optional()
      .describe('Optional priority level (default: "none")'),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .optional()
      .describe('Optional due date in YYYY-MM-DD format'),
  },
  async ({ boardId, column, title, description, priority, dueDate }) => {
    try {
      const card = await client.createCard({
        boardId,
        column,
        title,
        description,
        priority,
        dueDate,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Card created successfully!\n\nID: ${card.id}\nTitle: "${card.title}"\nBoard: ${card.boardName} (${card.boardId})\nColumn: ${card.columnName} (${card.columnId})\nPriority: ${card.priority}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to create card: ${err.message}` }],
      };
    }
  },
);

// Tool 5: Search Cards in a Project
server.tool(
  'flowboard_search_cards',
  'Search for existing cards in a project to check for duplicates before creating new ones.',
  {
    projectId: z.string().describe('The ID of the project'),
    query: z.string().describe('The keywords to search for in card titles or descriptions'),
  },
  async ({ projectId, query }) => {
    try {
      const cards = await client.searchCards(projectId, query);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(cards, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to search cards: ${err.message}` }],
      };
    }
  },
);

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Flowboard MCP] Server running on stdio');
}

run().catch((err) => {
  console.error('[Flowboard MCP] Fatal error starting server:', err);
  process.exit(1);
});
