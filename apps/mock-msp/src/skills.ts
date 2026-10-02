/** Stand-in for the skills the MSPbots platform lists. Steps that follow one call no tool themselves. */
export const skills = [
  { name: 'classify-ticket', description: 'Sort a ticket into category, priority and whether it is a security issue, from its title and description.' },
  { name: 'extract-hr-form', description: 'Read an HR onboarding or offboarding form out of a ticket description: names, dates, office, manager, hardware, access requests.' },
  { name: 'draft-customer-reply', description: 'Write a short, polite reply to the end user in the ticket language, following the MSP tone guide.' },
  { name: 'summarize-ticket-history', description: 'Summarise the notes and time entries on a ticket into what was done, what is pending and who is waiting.' },
  { name: 'triage-security-alert', description: 'Judge whether a security alert is a false positive, needs isolation now, or needs a human, with the reasons.' },
];
