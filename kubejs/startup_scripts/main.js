StartupEvents.registry('item', (event) => {
  event.create('coin')
    .displayName('Gold Coin')
    .tooltip('§6Official modpack currency')

  event.create('silver_coin')
    .displayName('Silver Coin')
    .tooltip('§7Official modpack currency')

  event.create('copper_coin')
    .displayName('Copper Coin')
    .tooltip('§6Official modpack currency')

  event.create('help')
    .displayName('Help')

  event.create('raid_time_rewind')
    .displayName('Raid Time Rewind')
    .tooltip('Right-click to rewind your personal raid day by 10.')
})
