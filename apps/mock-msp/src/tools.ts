import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Tenant } from './tenant.js';

export interface CallLog {
  seq: number;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
}

class ToolError extends Error {}

/** Builds one MCP server per connector over a shared tenant, recording every call. */
export function buildServers(tenant: Tenant, log: CallLog[]) {
  const make = (name: string, description: string) => {
    const server = new McpServer({ name, version: '0.1.0' }, { instructions: description });
    const tool = <S extends z.ZodRawShape>(toolName: string, desc: string, writes: boolean, schema: S, fn: (args: z.infer<z.ZodObject<S>>) => unknown) =>
      server.registerTool(toolName, { description: desc, inputSchema: schema, annotations: { readOnlyHint: !writes } }, (async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
        const entry: CallLog = { seq: log.length + 1, server: name, tool: toolName, args, ok: true };
        log.push(entry);
        try {
          entry.result = await fn(args);
          return { content: [{ type: 'text', text: JSON.stringify(entry.result) }] };
        } catch (err) {
          entry.ok = false;
          entry.error = err instanceof Error ? err.message : String(err);
          return { isError: true, content: [{ type: 'text', text: entry.error }] };
        }
      }) as never);
    return { server, tool };
  };

  // ---- Autotask
  const at = make('autotask', 'Autotask PSA of the MSP client Contoso Dental (company C-100).');
  at.tool('autotask_get_ticket', 'Read an Autotask ticket, including title, description, status, queue and company.', false, { ticket_id: z.string().describe('Ticket id or number, e.g. T20260930.0042') }, ({ ticket_id }) => {
    const t = tenant.findTicket(ticket_id);
    if (!t) throw new ToolError(`ticket ${ticket_id} not found`);
    return t;
  });
  at.tool('autotask_search_tickets', 'Search Autotask tickets by title keyword and status.', false, {
    title_contains: z.string().optional(),
    status_not: z.string().optional().describe('Exclude tickets in this status, e.g. Complete'),
    max_results: z.number().int().optional(),
  }, ({ title_contains, status_not, max_results }) =>
    tenant.tickets
      .filter((t) => (!title_contains || t.title.toLowerCase().includes(title_contains.toLowerCase())) && (!status_not || t.status !== status_not))
      .slice(0, max_results ?? 50)
      .map(({ id, number, title, status }) => ({ id, number, title, status })),
  );
  at.tool('autotask_create_ticket', 'Create an Autotask ticket for a company.', true, {
    company_id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    issue_type: z.string().optional(),
    sub_issue_type: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }, (a) => {
    const id = tenant.nextId('T');
    const ticket = { id, number: `T20260930.${id.slice(2)}`, companyId: a.company_id, title: a.title, description: a.description ?? '', status: 'New', queueId: 'Q-1', notes: [] };
    tenant.tickets.push(ticket);
    return { id: ticket.id, number: ticket.number };
  });
  at.tool('autotask_update_ticket', 'Update fields of an Autotask ticket, such as queue, status or assigned resource.', true, {
    ticket_id: z.string(),
    queue_id: z.string().optional(),
    status: z.string().optional(),
    assigned_resource_id: z.string().optional(),
  }, ({ ticket_id, queue_id, status }) => {
    const t = tenant.findTicket(ticket_id);
    if (!t) throw new ToolError(`ticket ${ticket_id} not found`);
    if (queue_id) {
      if (!tenant.queues.some((q) => q.id === queue_id)) throw new ToolError(`queue ${queue_id} does not exist`);
      t.queueId = queue_id;
    }
    if (status) t.status = status;
    return { id: t.id, queueId: t.queueId, status: t.status };
  });
  at.tool('autotask_list_queues', 'List the ticket queues configured in Autotask.', false, {}, () => tenant.queues);
  at.tool('autotask_create_ticket_note', 'Add a note to an Autotask ticket.', true, {
    ticket_id: z.string(),
    title: z.string().optional(),
    text: z.string(),
    internal: z.boolean().optional().describe('Internal notes are hidden from the customer'),
  }, ({ ticket_id, title, text, internal }) => {
    const t = tenant.findTicket(ticket_id);
    if (!t) throw new ToolError(`ticket ${ticket_id} not found`);
    t.notes.push({ title, text, internal: internal ?? true });
    return { ok: true, notes: t.notes.length };
  });
  at.tool('autotask_create_contact', 'Create a contact under an Autotask company.', true, {
    company_id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string(),
    mobile_phone: z.string().optional(),
    title: z.string().optional(),
  }, (a) => {
    const contact = { id: tenant.nextId('CT'), ...a };
    tenant.contacts.push(contact);
    return contact;
  });

  // ---- Microsoft Graph
  const g = make('microsoft-graph', 'Microsoft 365 tenant of Contoso Dental.');
  const user = (ref: string) => {
    const u = tenant.findUser(ref);
    if (!u) throw new ToolError(`Request_ResourceNotFound: user '${ref}' does not exist`);
    return u;
  };
  g.tool('graph_list_users', "List Microsoft 365 users. Use without a filter to learn the tenant's primary domain from userPrincipalName.", false, {
    display_name: z.string().optional(),
    max_results: z.number().int().optional(),
  }, ({ display_name, max_results }) =>
    tenant.users
      .filter((u) => !display_name || u.displayName.toLowerCase().includes(display_name.toLowerCase()))
      .slice(0, max_results ?? 100)
      .map(({ id, userPrincipalName, displayName }) => ({ id, userPrincipalName, displayName })),
  );
  g.tool('graph_check_user_exists', 'Check whether a user with the given user principal name exists.', false, { upn: z.string().describe('User principal name, e.g. jane.doe@contoso.com') }, ({ upn }) => ({
    upn,
    exists: !!tenant.findUser(upn),
  }));
  g.tool('graph_get_user', 'Read a Microsoft 365 user by id, UPN or email.', false, { user: z.string().describe('User id, UPN or email') }, (a) => user(a.user));
  g.tool('graph_create_user', 'Create a Microsoft 365 user with a temporary password.', true, {
    upn: z.string(),
    display_name: z.string(),
    given_name: z.string().optional(),
    surname: z.string().optional(),
    job_title: z.string().optional(),
    department: z.string().optional(),
    office_location: z.string().optional(),
    mobile_phone: z.string().optional(),
    password_length: z.number().int().optional(),
    force_change_password: z.boolean().optional(),
  }, (a) => {
    if (!a.upn.toLowerCase().endsWith(`@${tenant.domain}`)) throw new ToolError(`Request_BadRequest: domain of '${a.upn}' is not a verified domain of this tenant`);
    if (tenant.findUser(a.upn)) throw new ToolError(`Request_BadRequest: another object with the same userPrincipalName '${a.upn}' already exists`);
    if (/failcase/i.test(a.upn)) throw new ToolError('ServiceUnavailable: the directory is temporarily unavailable, try again later');
    const u = { id: tenant.nextId('u'), userPrincipalName: a.upn.toLowerCase(), displayName: a.display_name, jobTitle: a.job_title, department: a.department, officeLocation: a.office_location, mobilePhone: a.mobile_phone, groups: [], licenses: [] };
    tenant.users.push(u);
    return { id: u.id, userPrincipalName: u.userPrincipalName, temporaryPassword: 'x'.repeat(a.password_length ?? 16), forceChangePasswordNextSignIn: a.force_change_password ?? true };
  });
  g.tool('graph_update_user', 'Update properties of a Microsoft 365 user.', true, {
    user: z.string(),
    properties: z.record(z.string(), z.unknown()).describe('Graph user properties to set'),
  }, (a) => Object.assign(user(a.user), a.properties));
  g.tool('graph_assign_manager', 'Set the manager of a Microsoft 365 user.', true, { user: z.string(), manager: z.string() }, (a) => {
    const u = user(a.user);
    u.manager = user(a.manager).id;
    return { ok: true };
  });
  g.tool('graph_reset_password', "Reset a user's password to a new temporary password.", true, {
    user: z.string(),
    password_length: z.number().int().optional(),
    force_change_password: z.boolean().optional(),
  }, (a) => ({ id: user(a.user).id, temporaryPassword: 'x'.repeat(a.password_length ?? 16) }));
  g.tool('graph_check_license_stock', 'List subscribed license SKUs with total, consumed and available units.', false, {}, () =>
    tenant.skus.map((s) => ({ ...s, available: s.total - s.consumed })),
  );
  g.tool('graph_assign_license', 'Assign a license SKU to a user.', true, { user: z.string(), sku_part_number: z.string().describe('e.g. SPB, O365_BUSINESS_PREMIUM') }, (a) => {
    const u = user(a.user);
    const sku = tenant.skus.find((s) => s.skuPartNumber === a.sku_part_number);
    if (!sku) throw new ToolError(`Request_BadRequest: license ${a.sku_part_number} is not subscribed`);
    if (sku.consumed >= sku.total) throw new ToolError(`Request_BadRequest: no available units of ${a.sku_part_number}`);
    sku.consumed++;
    u.licenses.push(sku.skuPartNumber);
    return { ok: true, sku: sku.skuPartNumber };
  });
  g.tool('graph_assign_groups', 'Add a user to one or more groups.', true, {
    user: z.string(),
    groups: z.array(z.string()).describe('Group ids or display names'),
  }, (a) => {
    const u = user(a.user);
    const unknown = a.groups.filter((name) => !tenant.groups.includes(name));
    if (unknown.length) throw new ToolError(`Request_ResourceNotFound: groups not found: ${unknown.join(', ')}`);
    u.groups.push(...a.groups.filter((name) => !u.groups.includes(name)));
    return { ok: true, groups: u.groups };
  });
  g.tool('graph_search_sites', 'Search SharePoint sites by keyword.', false, { query: z.string() }, ({ query }) =>
    tenant.sites.filter((s) => `${s.name} ${s.items.map((i) => i.name).join(' ')}`.toLowerCase().includes(query.toLowerCase().split(' ')[0]!)).map(({ id, name }) => ({ id, name })),
  );
  g.tool('graph_list_drive_items', "List files in a SharePoint site's document library.", false, { site_id: z.string(), folder_path: z.string().optional() }, ({ site_id }) => {
    const site = tenant.sites.find((s) => s.id === site_id);
    if (!site) throw new ToolError(`site ${site_id} not found`);
    return site.items.map(({ id, name }) => ({ id, name }));
  });
  g.tool('graph_read_file_text', 'Read a document or spreadsheet from SharePoint as text.', false, { site_id: z.string(), item_id: z.string() }, ({ site_id, item_id }) => {
    const item = tenant.sites.find((s) => s.id === site_id)?.items.find((i) => i.id === item_id);
    if (!item) throw new ToolError(`item ${item_id} not found`);
    return { name: item.name, text: item.text };
  });

  // ---- MSPbots
  const mb = make('mspbots', 'MSPbots platform.');
  mb.tool('send_teams_message', 'Send a Microsoft Teams message to an MSPbots user by email.', true, { email: z.string(), text: z.string() }, (a) => {
    tenant.messages.push(a);
    return { ok: true, delivered: true };
  });

  return { autotask: at.server, 'microsoft-graph': g.server, mspbots: mb.server };
}
