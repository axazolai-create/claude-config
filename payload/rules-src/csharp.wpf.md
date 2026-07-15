---
paths:
  - "**/*.xaml"
  - "**/*.xaml.cs"
  - "**/*.Designer.cs"
---

# WPF / WinForms (desktop direction)
- MVVM: views bind to view models implementing `INotifyPropertyChanged` (or
  `CommunityToolkit.Mvvm`'s `ObservableObject`/`[ObservableProperty]`) - no business logic
  in code-behind beyond wiring the view up.
- `ICommand`/`RelayCommand` for UI actions bound via `Command="{Binding ...}"`, not
  click-handler methods that call into services directly from code-behind.
- `{Binding}`/`x:Bind` for data flow over manual control manipulation
  (`myTextBox.Text = ...`) from code-behind.
- WinForms projects: same MVVM-adjacent discipline via a presenter/controller class per
  form - don't put data-access or business logic directly in a `Form` subclass.
- Dependency injection for services/view models (`Microsoft.Extensions.DependencyInjection`
  host, or a DI-aware MVVM toolkit) instead of `new`-ing services inside a view model's
  constructor.
- Avoid: code-behind reaching into other windows/views directly, static mutable UI state,
  long-running work on the UI thread (use `async`/`await` with `Task.Run` for CPU-bound
  work, keep I/O naturally async).
