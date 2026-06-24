import { render } from '@inquirer/testing';
import { searchableList } from '../src/searchable.js';

const choices = [
  { name: 'AccountController', value: 'AccountController' },
  { name: 'AccountTriggerHandler', value: 'AccountTriggerHandler' },
  { name: 'ContactController', value: 'ContactController' },
  { name: 'LeadService', value: 'LeadService', checked: true },
  { name: 'OrderService', value: 'OrderService' },
];

function show(label, screen) {
  console.log(`\n----- ${label} -----`);
  console.log(screen);
}

// ---- TEST 1: live search filters, space checks, enter confirms (multiple) ----
{
  const { answer, events, getScreen } = await render(searchableList, {
    message: 'package.xml (add / update) — check the components',
    choices,
    multiple: true,
    pageSize: 16,
  });

  show('initial (LeadService pre-checked)', getScreen());

  events.type('account');
  show('after typing "account"', getScreen());

  events.keypress('space');      // check AccountController
  events.keypress('down');
  events.keypress('space');      // check AccountTriggerHandler
  show('after checking both Account*', getScreen());

  for (let i = 0; i < 'account'.length; i++) events.keypress('backspace');
  show('after clearing search', getScreen());

  events.keypress('enter');
  const result = await answer;
  console.log('\nRESULT (multiple):', result);
  const ok = result.includes('AccountController')
    && result.includes('AccountTriggerHandler')
    && result.includes('LeadService')
    && result.length === 3;
  console.log('TEST 1', ok ? 'PASS' : 'FAIL');
}

// ---- TEST 2: single-select type picker, search then enter selects highlighted ----
{
  const { answer, events, getScreen } = await render(searchableList, {
    message: 'pick a metadata type',
    choices: [
      { name: '✔ Finish & save  (0 staged)', value: ' __done__' },
      { name: 'ApexClass  (42)', value: 'ApexClass' },
      { name: 'ApexTrigger  (7)', value: 'ApexTrigger' },
      { name: 'LightningComponentBundle  (12)', value: 'LightningComponentBundle' },
    ],
    multiple: false,
    pageSize: 14,
  });

  show('type picker initial', getScreen());
  events.type('trigger');
  show('after typing "trigger"', getScreen());
  events.keypress('enter');
  const result = await answer;
  console.log('\nRESULT (single):', result);
  console.log('TEST 2', result === 'ApexTrigger' ? 'PASS' : 'FAIL');
}

// ---- TEST 3: uncheck a pre-checked item (remove semantics) ----
{
  const { answer, events } = await render(searchableList, {
    message: 'destructive: uncheck the ones to remove',
    choices: [
      { name: 'OldClassA', value: 'OldClassA', checked: true },
      { name: 'OldClassB', value: 'OldClassB', checked: true },
    ],
    multiple: true,
  });
  events.keypress('space');      // uncheck the highlighted (OldClassA)
  events.keypress('enter');
  const result = await answer;
  console.log('\nRESULT (remove):', result);
  console.log('TEST 3', result.length === 1 && result[0] === 'OldClassB' ? 'PASS' : 'FAIL');
}

// ---- TEST 4: multi-word token search ----
{
  const { answer, events, getScreen } = await render(searchableList, {
    message: 'field picker',
    choices: [
      { name: 'Account.Legacy__c', value: 'Account.Legacy__c' },
      { name: 'Account.Region__c', value: 'Account.Region__c' },
      { name: 'Contact.Legacy__c', value: 'Contact.Legacy__c' },
    ],
    multiple: true,
  });
  events.type('account legacy');
  show('token search "account legacy"', getScreen());
  events.keypress('space');
  events.keypress('enter');
  const result = await answer;
  console.log('\nRESULT (token):', result);
  console.log('TEST 4', result.length === 1 && result[0] === 'Account.Legacy__c' ? 'PASS' : 'FAIL');
}
