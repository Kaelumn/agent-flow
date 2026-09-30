/** Who is calling and on behalf of which workspace. */
export interface Principal {
  workspaceId: string;
  actor: string;
  /** Channel the call came through; recorded in history. */
  source: 'web' | 'mcp';
}
