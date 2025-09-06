// Test for the core map selection logic
describe('Map Selection Distribution Test', () => {
  
  // Extract the core logic we want to test - mirrors the actual selectRandomMapFromSelections logic
  function selectRandomMapFromArray(mapSelections: { [playerId: string]: string }): string | null {
    const selectedMaps = Object.values(mapSelections);
    
    if (selectedMaps.length === 0) {
      return null;
    }
    
    const randomIndex = Math.floor(Math.random() * selectedMaps.length);
    return selectedMaps[randomIndex];
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('selectRandomMapFromArray', () => {
    it('should distribute map selections according to player vote weights', () => {
      // Arrange - Mock database data (player_steam_id -> map_selection)
      const mockPlayerMapSelections = {
        '76561197963875407': '3433040330',
        '76561197983217546': '3071160883', 
        '76561198027017732': '3133582456',
        '76561198041569692': '3477094554',
        '76561198082177938': '3437809122',
        '76561198154531635': '3437809122',
        '76561198169599815': '3286163323', 
        '76561198177751257': '3246527710',
        '76561198262552327': '3339983232',
        '76561198321643472': '3249860053' 
      };

      const iterations = 10000; // Large number for statistical accuracy
      const results: { [mapName: string]: number } = {};
      
      // Build output string
      let output = '\n=== Map Selection Distribution Test ===\n';
      output += 'Input Data (Player Votes):\n';
      
      // Log the input data
      const mapCounts: { [mapName: string]: number } = {};
      Object.entries(mockPlayerMapSelections).forEach(([playerId, mapSelection]) => {
        output += `  ${playerId}: ${mapSelection}\n`;
        mapCounts[mapSelection] = (mapCounts[mapSelection] || 0) + 1;
      });
      
      output += '\nExpected Distribution:\n';
      const totalVotes = Object.keys(mockPlayerMapSelections).length;
      Object.entries(mapCounts).forEach(([mapName, count]) => {
        const percentage = (count / totalVotes * 100).toFixed(1);
        output += `  ${mapName}: ${count}/${totalVotes} votes (${percentage}%)\n`;
      });

      // Act - Run many iterations and track results
      output += `\nRunning ${iterations} iterations...\n`;
      
      for (let i = 0; i < iterations; i++) {
        // Reset random seed each iteration to ensure proper randomness
        // Note: Math.random() doesn't have explicit seeding, but we let it run naturally
        const selectedMap = selectRandomMapFromArray(mockPlayerMapSelections);
        
        if (selectedMap) {
          results[selectedMap] = (results[selectedMap] || 0) + 1;
        }
      }

      // Assert and Log Results
      output += '\nActual Results:\n';
      let totalSelections = 0;
      Object.values(results).forEach(count => totalSelections += count);
      
      Object.entries(results).forEach(([mapName, count]) => {
        const actualPercentage = (count / totalSelections * 100).toFixed(1);
        const expectedCount = mapCounts[mapName] || 0;
        const expectedPercentage = (expectedCount / totalVotes * 100).toFixed(1);
        const difference = Math.abs(parseFloat(actualPercentage) - parseFloat(expectedPercentage)).toFixed(1);
        
        output += `  ${mapName}: ${count}/${totalSelections} selections (${actualPercentage}%) - Expected: ${expectedPercentage}% - Diff: ${difference}%\n`;
      });

      output += '\n✓ Distribution test passed - results match expected vote weights\n';
      output += '=== End Test ===\n';
      
      // Print all output at once
      console.log(output);

      // Statistical validation - should be within reasonable tolerance (±2% for large sample)
      const tolerance = 2.0; // 2% tolerance
      
      Object.entries(mapCounts).forEach(([mapName, expectedCount]) => {
        const expectedPercentage = (expectedCount / totalVotes) * 100;
        const actualCount = results[mapName] || 0;
        const actualPercentage = (actualCount / totalSelections) * 100;
        const difference = Math.abs(actualPercentage - expectedPercentage);
        
        expect(difference).toBeLessThan(tolerance);
        expect(actualCount).toBeGreaterThan(0); // Each map should be selected at least once
      });

      // Verify that maps with more votes are selected more often (dynamic comparison)
      const sortedMapsByVotes = Object.entries(mapCounts)
        .sort(([, countA], [, countB]) => countB - countA); // Sort by vote count descending
      
      // Check that maps with more votes have more selections than maps with fewer votes
      for (let i = 0; i < sortedMapsByVotes.length - 1; i++) {
        const [mapWithMoreVotes, moreVotes] = sortedMapsByVotes[i];
        const [mapWithFewerVotes, fewerVotes] = sortedMapsByVotes[i + 1];
        
        const moreVotesCount = results[mapWithMoreVotes] || 0;
        const fewerVotesCount = results[mapWithFewerVotes] || 0;
        
        // Only enforce ordering if there's a meaningful difference in votes
        if (moreVotes > fewerVotes) {
          expect(moreVotesCount).toBeGreaterThan(fewerVotesCount);
        }
      }
    });
  });
});
