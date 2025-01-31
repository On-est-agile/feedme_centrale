# Centrale de FeedMe

## Installation
```
yarn
yarn run init
yarn run start
```
## Publish Topics

### Tenant Feeders List
- **Topic:** `feedme/{tenant_name}/feeders`
- **Payload:** `{ feeders: [] }`
- **Description:** Broadcasts list of feeders for a specific tenant
- **Frequency:** Every 10 seconds

### Tenant Feeders List
- **Topic:** `feedme/{tenant_name}/{feeder}/sensors/balance_bottom`
- **Payload:** `{ amount: number }`
- **Description:** Broadcasts pressure sensor reading from bottom of feeder
- **Frequency:** Each sensor reading

## Subscribe Topics

### Feeder Dispense Command
- **Topic:** `feedme/{tenant_name}/{feeder_id}/commands/feeder/dispense`
- **Payload:** `{ amount: number }`
- **Actions:**
  - Open trap
  - Dispense food
  - Close trap

### Feeder Rename
- **Topic:** `feedme/{tenant_name}/feeders/{feeder_id}/rename`
- **Payload:** `{ name: string }`
- **Action:** Update feeder name in database

## Configuration
- Default MQTT Broker: Configured via environment variables
- Default Port: 1883
- Connection Timeout: 5 seconds
- Reconnect Period: 1 second