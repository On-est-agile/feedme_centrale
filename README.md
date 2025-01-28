# feedme_centrale

## Installation
```
yarn
yarn run start
```

## Nomencalture
For sensors :
`feedme/sensors/{device_id}/{sensor_type}`
    - Sample :
        `feedme/{secret}/sensors/balance_bottom/weight`

For commands :
`feedme/commands/{device_id}/{action}`
    - Sample :
        `feedme/{secret}/commands/trap_top/open`
        `feedme/{secret}/commands/trap_bottom/open`

For statuses :
`feedme/statuses/{device_id}`
    - Sample :
        `feedme/{secret}/statuses/trap_top`
        `feedme/{secret}/statuses/trap_bottom`
        `feedme/{secret}/statuses/balance_bottom`