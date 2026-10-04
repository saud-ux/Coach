import SwiftUI
import UserNotifications

struct CoachReminder: Identifiable, Codable {
    var id = UUID()
    var title: String
    var date: Date
    var daily: Bool
}
@MainActor final class ReminderStore: ObservableObject {
    @Published var items: [CoachReminder] = []
    @Published var message = ""
    private let center = UNUserNotificationCenter.current()
    init() {
        if let data = UserDefaults.standard.data(forKey: "native-reminders") { items = (try? JSONDecoder().decode([CoachReminder].self, from: data)) ?? [] }
    }
    func add(title: String, date: Date, daily: Bool, editing: UUID? = nil) async {
        guard editing != nil || items.count < 50 else { message = "وصلت حد 50 تذكيرًا؛ احذف تذكيرًا قبل الإضافة."; return }
        guard daily || date > Date() else { message = "اختر موعدًا في المستقبل."; return }
        do {
            guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else { message = "فعّل الإشعارات من إعدادات الآيفون."; return }
            let item = CoachReminder(id: editing ?? UUID(), title: title, date: date, daily: daily)
            let content = UNMutableNotificationContent(); content.title = "جدول الحكم"; content.body = title; content.sound = .default
            let fields: Set<Calendar.Component> = daily ? [.hour, .minute] : [.year, .month, .day, .hour, .minute]
            let trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents(fields, from: date), repeats: daily)
            try await center.add(UNNotificationRequest(identifier: item.id.uuidString, content: content, trigger: trigger))
            if let index = items.firstIndex(where: { $0.id == item.id }) { items[index] = item } else { items.append(item) }
            save(); message = "تم حفظ التذكير."
        } catch { message = error.localizedDescription }
    }
    func remove(_ offsets: IndexSet) {
        center.removePendingNotificationRequests(withIdentifiers: offsets.map { items[$0].id.uuidString })
        items.remove(atOffsets: offsets); save()
    }
    func save() { if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: "native-reminders") } }
}
struct ReminderView: View {
    @ObservedObject var store: ReminderStore
    @State private var kind = "شرب الماء"
    @State private var date = Date().addingTimeInterval(3600)
    @State private var daily = false
    @State private var saving = false
    @State private var editing: UUID?
    var body: some View {
        List {
            Section("إضافة تذكير") {
                Picker("النوع", selection: $kind) { ForEach(["موعد التمرين", "موعد المباراة", "شرب الماء", "موعد النوم"], id: \.self) { Text($0) } }
                Toggle("يتكرر يوميًا", isOn: $daily)
                DatePicker("الموعد", selection: $date, displayedComponents: daily ? [.hourAndMinute] : [.date, .hourAndMinute])
                Button(editing == nil ? "حفظ التذكير" : "حفظ التعديل") { saving = true; Task { await store.add(title: kind, date: date, daily: daily, editing: editing); saving = false } }.disabled(saving)
                if editing != nil { Button("إضافة تذكير جديد") { editing = nil } }
                Text(store.message).font(.footnote)
                Text("هذه التذكيرات تضيفها يدويًا. لإضافة تذكيرات ماء متعددة، اختر كل موعد واحفظه. لا تُرسل رسائل المدرب تلقائيًا.").font(.footnote)
            }
            Section("اضغط للتعديل — اسحب للحذف") {
                ForEach(store.items) { item in
                    Button { editing = item.id; kind = item.title; date = item.date; daily = item.daily } label: {
                        VStack(alignment: .leading) { Text(item.title); Text(item.daily ? "يوميًا \(item.date.formatted(date: .omitted, time: .shortened))" : item.date.formatted()).font(.footnote) }
                    }
                }.onDelete(perform: store.remove)
            }
        }.navigationTitle("التذكيرات")
    }
}
