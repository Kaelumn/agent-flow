import type { GraphOp, NodeInput } from '@agent-flow/core';

const NOTIFY_TO = 'the notify_to address from the flow description';

const tool = (id: string, title: string, name: string, argsHint: Record<string, string>, extra: Partial<NodeInput> = {}): NodeInput => ({
  id,
  type: 'tool',
  title,
  tool: { name, argsHint },
  ...extra,
});

const teams = (id: string, title: string, text: string, extra: Partial<NodeInput> = {}) =>
  tool(id, title, 'send_teams_message', { email: NOTIFY_TO, text }, { onError: { strategy: 'continue' }, ...extra });

export const onboardingTemplate = {
  title: 'Focus ITS new-employee onboarding',
  description:
    'Provision a new hire from an Autotask onboarding ticket: M365 account, manager, groups, license, Autotask contact and hardware ticket. ' +
    'Every human-only task is sent to notify_to = it-ops@focusits.example via Teams. ' +
    'Offices and their default groups: spokane (ext 400, alarm access; groups All Staff, Spokane Staff), renton_seattle (ext 500; groups All Staff, Renton Staff), tacoma (ext 100; groups All Staff, Tacoma Staff). ' +
    'Add the Confidential group when the form asks for confidential access. ' +
    'Never close the original ticket.',
  ops: [
    {
      op: 'updateNode',
      nodeId: 'start',
      patch: { inputs: [{ name: 'ticket_id', description: 'Autotask onboarding ticket id', required: true }] },
    },
    { op: 'removeNode', nodeId: 'end' },
    {
      op: 'addNodes',
      nodes: [
        tool('read_ticket', 'Read the onboarding ticket', 'autotask_get_ticket', { ticket_id: '{{input.ticket_id}}' }, {
          outputKey: 'ticket',
          instruction:
            'Extract the HR form: first name, last name, start date, job title, department, office, license type, hiring manager email, hardware needed, shipping address (required when hardware is needed), confidential access.',
        }),
        teams('notify_missing', 'Report missing form fields', 'List every missing or invalid field and the ticket number.'),
        tool('list_users', 'Find the tenant domain', 'graph_list_users', { max_results: '5' }, {
          outputKey: 'tenant_users',
          instruction: 'Take the domain from the returned userPrincipalName values. Never infer it from any email in the form.',
        }),
        tool('check_user', 'Check the account does not exist', 'graph_check_user_exists', { upn: 'first.last@<domain from tenant_users>, lowercase' }, {
          outputKey: 'user_exists',
        }),
        teams('notify_exists', 'Report existing account', 'The account already exists; a human must handle this ticket.'),
        tool('create_hw_ticket', 'Create the hardware ticket', 'autotask_create_ticket', {
          company_id: '{{ticket.companyId}}',
          title: '{full name} – {start date} – Hardware',
          issue_type: 'Computer',
          sub_issue_type: 'Hardware',
        }, { outputKey: 'hw_ticket', onError: { strategy: 'continue' } }),
        tool('list_queues', 'Look up the Dispatch queue', 'autotask_list_queues', {}, { outputKey: 'queues', onError: { strategy: 'continue' } }),
        tool('move_to_dispatch', 'Move the hardware ticket to Dispatch', 'autotask_update_ticket', {
          ticket_id: '{{hw_ticket.id}}',
          queue_id: 'id of the "Dispatch" queue in queues',
        }, { onError: { strategy: 'continue' } }),
        teams('notify_shipping', 'Send the shipping address', 'Shipping address for the hardware; mention if the Dispatch queue is missing.'),
        tool('license_stock', 'Check license stock', 'graph_check_license_stock', {}, {
          outputKey: 'license_stock',
          instruction:
            'License: Microsoft 365 Business Premium (SPB) when hardware is requested, otherwise the form license. SKU map: Business Premium → SPB, Business Standard → O365_BUSINESS_PREMIUM, Business Basic → O365_BUSINESS_ESSENTIALS.',
        }),
        teams('notify_procurement', 'Request license procurement', 'No available units of the required SKU; procure one.'),
        tool('create_user', 'Create the M365 account', 'graph_create_user', {
          upn: '{{user_exists.upn}}',
          display_name: '{first name} {last name}',
          given_name: 'form first name',
          surname: 'form last name',
          job_title: 'form job title',
          department: 'form department',
          office_location: 'form office',
          password_length: '16',
          force_change_password: 'true',
        }, { outputKey: 'new_user', onError: { strategy: 'goto', targetNodeId: 'notify_failure' } }),
        tool('assign_manager', 'Assign the hiring manager', 'graph_assign_manager', { user: '{{new_user.id}}', manager: 'form hiring manager email' }, {
          onError: { strategy: 'continue' },
        }),
        tool('assign_groups', 'Add groups', 'graph_assign_groups', {
          user: '{{new_user.id}}',
          groups: 'default groups of the office, exactly as listed in the flow description, plus "Confidential" when the form asks for it',
        }, { onError: { strategy: 'continue' } }),
        tool('assign_license', 'Assign the license', 'graph_assign_license', { user: '{{new_user.id}}', sku_part_number: 'SKU chosen in license_stock' }, {
          onError: { strategy: 'continue' },
        }),
        tool('create_contact', 'Create the Autotask contact', 'autotask_create_contact', {
          company_id: '{{ticket.companyId}}',
          first_name: 'form first name',
          last_name: 'form last name',
          email: '{{new_user.userPrincipalName}}',
          mobile_phone: 'form mobile phone',
        }, { onError: { strategy: 'continue' } }),
        teams('notify_manual', 'Send the human-only tasks', 'One message listing every task that applies, each on its own line: RingCentral extension, alarm PIN (Spokane only), WiFi password, street address, cloud apps / printer / HR system when requested, sign-in verification, and any step of this run that failed or was skipped.'),
        tool('summary_note', 'Write the summary note', 'autotask_create_ticket_note', {
          ticket_id: '{{input.ticket_id}}',
          text: '[Onboarding agent] done / pending / failed summary. Close the ticket after review.',
          internal: 'true',
        }, { onError: { strategy: 'continue' } }),
        teams('notify_failure', 'Report the failed account creation', 'Account creation failed; include the error and the ticket number.'),
        { id: 'end_not_onboarding', type: 'end', title: 'Skipped: not an onboarding ticket', outcome: 'stopped' },
        { id: 'end_missing', type: 'end', title: 'Stopped: form incomplete', outcome: 'stopped' },
        { id: 'end_exists', type: 'end', title: 'Stopped: account exists', outcome: 'stopped' },
        { id: 'end_failed', type: 'end', title: 'Failed: account not created', outcome: 'failed' },
        { id: 'end_done', type: 'end', title: 'Onboarding done', outcome: 'completed' },
      ],
    },
    {
      op: 'addEdges',
      edges: [
        { source: 'start', target: 'read_ticket' },
        { source: 'read_ticket', target: 'end_not_onboarding', condition: 'the ticket is not a new-hire or onboarding request' },
        { source: 'read_ticket', target: 'notify_missing', condition: 'it is an onboarding request, but a required field is missing or the office is not a known office' },
        { source: 'read_ticket', target: 'list_users', isDefault: true },
        { source: 'notify_missing', target: 'end_missing' },
        { source: 'list_users', target: 'check_user' },
        { source: 'check_user', target: 'notify_exists', condition: 'the account already exists' },
        { source: 'check_user', target: 'create_hw_ticket', condition: 'the account does not exist and hardware is requested' },
        { source: 'check_user', target: 'license_stock', isDefault: true },
        { source: 'notify_exists', target: 'end_exists' },
        { source: 'create_hw_ticket', target: 'list_queues' },
        { source: 'list_queues', target: 'move_to_dispatch', condition: 'a queue named Dispatch exists' },
        { source: 'list_queues', target: 'notify_shipping', isDefault: true },
        { source: 'move_to_dispatch', target: 'notify_shipping' },
        { source: 'notify_shipping', target: 'license_stock' },
        { source: 'license_stock', target: 'notify_procurement', condition: 'no available units of the required SKU' },
        { source: 'license_stock', target: 'create_user', isDefault: true },
        { source: 'notify_procurement', target: 'create_user' },
        { source: 'create_user', target: 'assign_manager' },
        { source: 'assign_manager', target: 'assign_groups' },
        { source: 'assign_groups', target: 'assign_license', condition: 'the required SKU was in stock' },
        { source: 'assign_groups', target: 'create_contact', isDefault: true },
        { source: 'assign_license', target: 'create_contact' },
        { source: 'create_contact', target: 'notify_manual' },
        { source: 'notify_manual', target: 'summary_note' },
        { source: 'summary_note', target: 'end_done' },
        { source: 'notify_failure', target: 'end_failed' },
      ],
    },
  ] satisfies GraphOp[] as GraphOp[],
};
