import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DiaryService } from './services/diary.service';
import { StartpageComponent } from './components/startpage/startpage';
import { EditorComponent } from './components/editor/editor';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, StartpageComponent, EditorComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  diaryService = inject(DiaryService);
}
