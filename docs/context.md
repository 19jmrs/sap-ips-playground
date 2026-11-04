# Supplying runtime context

Open Runtime context and supply a JSON object. Only provide values from the intended test scenario. The application does not contact IPS or infer provisioning state.

```json
{
  "variables": {
    "entityIdSourceSystem": "source-1",
    "entityIdTargetSystem": "target-42",
    "currentDate": "2026-11-02 12:00:00.000"
  },
  "properties": { "domain": "example.com", "ips.application.id": "demo-app" },
  "operation": "createEntity",
  "resolutions": { "user": { "source-1": "target-42" } },
  "localeMappings": [["EN", "en-US"], ["PT", "pt-PT"]]
}
```

These are fictional fixtures, including the illustrative locale pairs; this is not SAP's complete default-language master data. Locale conversion needs the intended authoritative ordered ISO639/BCP47 pairs. Missing required tables/variables/properties produce errors.

Use `${entityIdTargetSystem}` for variable interpolation and `%domain%` for property interpolation. `sourceVariable` and `targetVariable` read/write local variables. Each entity and stage starts with a fresh copy of supplied context; variables created by source mappings do not implicitly leak to target mappings.

`operation` selects local scope rules only. It sends no create, patch or delete request. `resolveEntityIds` reads `resolutions.user`/`resolutions.group`, or a table under the key `sourceSystemName|targetSystemName|entityType`. Missing IDs fail rather than being fabricated.

For a live differential reference, preserve a fictional/anonymized input, exact transformation, supplied context, actual SAP output/error and SAP environment/date. The same case can then be compared locally. No credentials are needed. Unit fixtures are not live differential evidence.
