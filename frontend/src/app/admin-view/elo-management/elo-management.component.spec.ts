import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EloManagementComponent } from './elo-management.component';

describe('EloManagementComponent', () => {
  let component: EloManagementComponent;
  let fixture: ComponentFixture<EloManagementComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EloManagementComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EloManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
