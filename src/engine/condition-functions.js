import { fail, own } from './util.js';

const GROUP_EXTENSION = 'urn:ietf:params:scim:schemas:extension:sap:2.0:Group';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(args) {
  const values = Array.isArray(args[0]) ? args[0] : [args[0]];
  return values.every((value) => typeof value === 'string' && EMAIL_PATTERN.test(value));
}

function isRegularGroup(data) {
  const group = data?.[GROUP_EXTENSION] ?? {};
  return !own(group, 'supportedOperations') || !own(group, 'applicationId');
}

function isApplicationSpecificGroup(data, env) {
  if (!own(env.properties, 'ips.application.id')) fail('Missing context property: ips.application.id');
  const applicationId = data?.[GROUP_EXTENSION]?.applicationId;
  return applicationId === env.properties['ips.application.id'];
}

// `prefixProperty` names a context property holding the prefix. With no value or no
// prefix the optional variant passes and the mandatory variant fails.
function hasPrefix(name, args, env) {
  const prefix = env.properties[args[1]];
  if (args[0] == null || prefix == null) return name === 'isAttributeWithOptionalPrefix';
  return String(args[0]).startsWith(String(prefix));
}

export function conditionalFunction(name, args, data, env) {
  switch (name) {
    case 'isValidEmail':
      return isValidEmail(args);
    case 'isRegularGroup':
      return isRegularGroup(data);
    case 'isApplicationSpecificGroup':
      return isApplicationSpecificGroup(data, env);
    case 'isAttributeWithOptionalPrefix':
    case 'isAttributeWithMandatoryPrefix':
      return hasPrefix(name, args, env);
    default:
      return fail(`Unsupported conditional function: ${name}`);
  }
}
