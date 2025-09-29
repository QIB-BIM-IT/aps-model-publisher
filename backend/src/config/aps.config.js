// src/config/aps.config.js
const qs = require('querystring');

const apsConfig = {
  credentials: {
    client_id: process.env.APS_CLIENT_ID,
    client_secret: process.env.APS_CLIENT_SECRET,
    callback_url: process.env.APS_CALLBACK_URL,
    scopes: (process.env.APS_SCOPES || 'data:read data:write data:create account:read account:write')
      .split(/\s+/).filter(Boolean),
  },
  apis: {
    baseUrl: 'https://developer.api.autodesk.com',
    dataManagement: {
      hubs: '/project/v1/hubs',
      projects: '/project/v1/hubs/{hub_id}/projects',
      // nouveaux:
      topFolders: '/project/v1/hubs/{hub_id}/projects/{project_id}/topFolders',
      folderContents: '/data/v1/projects/{project_id}/folders/{folder_id}/contents',
      // utilitaires:
      folders: '/data/v1/projects/{project_id}/folders',
      items: '/data/v1/projects/{project_id}/items',
      versions: '/data/v1/items/{item_id}/versions',
    },
    modelDerivative: {
      manifest: '/modelderivative/v2/designdata/{urn}/manifest',
      metadata: '/modelderivative/v2/designdata/{urn}/metadata',
      properties: '/modelderivative/v2/designdata/{urn}/metadata/{guid}/properties',
    },
    designAutomation: {
      workItems: '/da/us-east/v3/workitems',
      activities: '/da/us-east/v3/activities',
      appBundles: '/da/us-east/v3/appbundles',
      engines: '/da/us-east/v3/engines',
    },
    webhooks: {
      hooks: '/webhooks/v1/systems/data/hooks',
      events: '/webhooks/v1/systems/data/events',
    },
  },
  endpoints: {
    AUTHORIZE: 'https://developer.api.autodesk.com/authentication/v2/authorize',
    TOKEN: 'https://developer.api.autodesk.com/authentication/v2/token',
    USERINFO: 'https://api.userprofile.autodesk.com/userinfo',
  },
  webhooks: {
    callbackUrl: process.env.WEBHOOK_CALLBACK_URL,
    secret: process.env.WEBHOOK_SECRET,
  },
  buildAuthorizeUrl({ redirectUri, scopes, state, extraParams = {} }) {
    const base = {
      response_type: 'code',
      client_id: this.credentials.client_id,
      redirect_uri: redirectUri || this.credentials.callback_url,
      scope: (scopes?.length ? scopes : this.credentials.scopes).join(' '),
      state,
      ...extraParams,
    };
    const q = qs.stringify(base);
    return `${this.endpoints.AUTHORIZE}?${q}`;
  },
};

module.exports = { apsConfig };
