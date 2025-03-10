import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkshopItemCardComponent } from './workshop-item-card.component';

describe('WorkshopItemCardComponent', () => {
  let component: WorkshopItemCardComponent;
  let fixture: ComponentFixture<WorkshopItemCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkshopItemCardComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(WorkshopItemCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
