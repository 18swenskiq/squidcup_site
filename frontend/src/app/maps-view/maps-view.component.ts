import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { environment } from '../../environments/environment';

export interface MapStats {
  id: string;
  name: string;
  totalRounds: number;
  totalGames: number;
}

export interface MapStatsResponse {
  wingman: MapStats[];
  threev3: MapStats[];
  fivev5: MapStats[];
}

@Component({
  selector: 'app-maps-view',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './maps-view.component.html',
  styleUrl: './maps-view.component.scss'
})
export class MapsViewComponent implements OnInit {
  wingmanMaps: MapStats[] = [];
  threev3Maps: MapStats[] = [];
  fivev5Maps: MapStats[] = [];
  
  isLoading = true;
  error: string | null = null;
  
  // Sorting state for each table
  wingmanSort: { column: string; direction: 'asc' | 'desc' } = { column: 'mapName', direction: 'desc' };
  threev3Sort: { column: string; direction: 'asc' | 'desc' } = { column: 'mapName', direction: 'desc' };
  fivev5Sort: { column: string; direction: 'asc' | 'desc' } = { column: 'mapName', direction: 'desc' };

  constructor(private http: HttpClient, @Inject(PLATFORM_ID) private platformId: Object) { }

  ngOnInit(): void {
    // Only load data in the browser, not during server-side rendering
    if (isPlatformBrowser(this.platformId)) {
      this.loadMapStats();
    } else {
      this.isLoading = false;
    }
  }

  loadMapStats(): void {
    this.isLoading = true;
    this.error = null;

    const apiUrl = `${environment.apiUrl}/mapStats`;
    
    this.http.get<MapStatsResponse>(apiUrl).subscribe({
      next: (response) => {
        this.wingmanMaps = response.wingman;
        this.threev3Maps = response.threev3;
        this.fivev5Maps = response.fivev5;
        this.sortMaps('wingman', this.wingmanSort.column);
        this.sortMaps('threev3', this.threev3Sort.column);
        this.sortMaps('fivev5', this.fivev5Sort.column);
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading map stats:', error);
        this.error = 'Failed to load map statistics. Please try again later.';
        this.isLoading = false;
      }
    });
  }

  sortMaps(gameMode: string, column: string): void {
    let currentSort: { column: string; direction: 'asc' | 'desc' };
    let mapArray: MapStats[];

    // Get the appropriate sorting state and map array
    switch (gameMode) {
      case 'wingman':
        currentSort = this.wingmanSort;
        mapArray = this.wingmanMaps;
        break;
      case 'threev3':
        currentSort = this.threev3Sort;
        mapArray = this.threev3Maps;
        break;
      case 'fivev5':
        currentSort = this.fivev5Sort;
        mapArray = this.fivev5Maps;
        break;
      default:
        return;
    }

    // Toggle direction if same column, otherwise default to desc for numeric columns
    if (currentSort.column === column) {
      currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort.column = column;
      currentSort.direction = column === 'mapName' ? 'asc' : 'desc';
    }

    // Sort the array
    mapArray.sort((a, b) => {
      let valueA: any;
      let valueB: any;

      switch (column) {
        case 'name':
          valueA = a.name.toLowerCase();
          valueB = b.name.toLowerCase();
          break;
        case 'totalGames':
          valueA = a.totalGames;
          valueB = b.totalGames;
          break;
        case 'totalRounds':
          valueA = a.totalRounds;
          valueB = b.totalRounds;
          break;
        default:
          return 0;
      }

      let comparison = 0;
      if (valueA < valueB) {
        comparison = -1;
      } else if (valueA > valueB) {
        comparison = 1;
      }

      return currentSort.direction === 'asc' ? comparison : -comparison;
    });
  }

  getSortIcon(gameMode: string, column: string): string {
    let currentSort: { column: string; direction: 'asc' | 'desc' };

    switch (gameMode) {
      case 'wingman':
        currentSort = this.wingmanSort;
        break;
      case 'threev3':
        currentSort = this.threev3Sort;
        break;
      case 'fivev5':
        currentSort = this.fivev5Sort;
        break;
      default:
        return '↕️';
    }

    if (currentSort.column !== column) {
      return '↕️'; // Neutral sort icon
    }
    return currentSort.direction === 'asc' ? '↑' : '↓';
  }

  getSortClass(gameMode: string, column: string): string {
    let currentSort: { column: string; direction: 'asc' | 'desc' };

    switch (gameMode) {
      case 'wingman':
        currentSort = this.wingmanSort;
        break;
      case 'threev3':
        currentSort = this.threev3Sort;
        break;
      case 'fivev5':
        currentSort = this.fivev5Sort;
        break;
      default:
        return 'sortable';
    }

    if (currentSort.column === column) {
      return `sorted-${currentSort.direction}`;
    }
    return 'sortable';
  }

  openMapWorkshop(mapId: string): void {
    const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mapId}`;
    window.open(workshopUrl, '_blank');
  }
}
