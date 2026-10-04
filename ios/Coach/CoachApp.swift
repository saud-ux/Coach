import SwiftUI
import WebKit
import HealthKit
import CoreLocation
import UserNotifications

@main
struct CoachApp: App {
    @StateObject private var model = CoachModel()
    var body: some Scene {
        WindowGroup { CoachHome(model: model).environment(\.layoutDirection, .rightToLeft).tint(Color(red: 0.12, green: 0.42, blue: 0.26)) }
    }
}

@MainActor final class CoachModel: ObservableObject {
    let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    @Published var message = ""
    @Published var busy = false
    @Published var loadFailed = false
    @Published var healthSummary = ""
    let health = HealthReader()
    let run = RunRecorder()
    let reminders = ReminderStore()
    init() { web.load(URLRequest(url: URL(string: "https://referee-coach.onrender.com/")!)) }
    func importHealth() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let payload = try await health.read()
            healthSummary = payload["summary"] as? String ?? ""
            let result = try await web.callAsyncJavaScript("""
                if(location.origin !== 'https://referee-coach.onrender.com') throw Error('صفحة غير موثوقة');
                const r = await fetch('/api/health', {method:'POST',headers:{'Content-Type':'application/json','X-Passcode':localStorage.getItem('rc-pass')||''},body:JSON.stringify(payload)});
                if(!r.ok) throw Error(r.status===401?'افتح المدرب وأدخل رمز الخادم ثم أعد الاستيراد':'تعذر الاستيراد: '+r.status);
                const d = await r.json();
                const h = await import('/js/health.js'); const synced = await h.syncHealth({force:true});
                if(!synced.ok) throw Error('تم إرسال البيانات لكن تعذر تحديث العرض؛ أعد فتح التطبيق');
                const m = await import('/js/main.js'); m.renderAll();
                return JSON.stringify(d);
                """, arguments: ["payload": payload], in: nil, contentWorld: .page)
            _ = result
            UserDefaults.standard.set(Date(), forKey: "last-health-import")
            message = "تم إرسال البيانات المتاحة وتحديث الصفحة. البيانات غير المسموحة أو غير الموجودة لن تُستورد."
        } catch { message = error.localizedDescription }
    }
}

struct CoachHome: View {
    @ObservedObject var model: CoachModel
    @State private var tools = false
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("جدول الحكم").font(.headline)
                Spacer()
                Button("أدوات الآيفون", systemImage: "iphone") { tools = true }
            }.padding(.horizontal).padding(.vertical, 8)
            if model.loadFailed {
                Button("تعذر الاتصال — أعد المحاولة") { model.web.reload() }.padding()
            }
            CoachWeb(model: model)
        }
        .sheet(isPresented: $tools) { ToolsView(model: model) }
    }
}

struct CoachWeb: UIViewRepresentable {
    @ObservedObject var model: CoachModel
    func makeCoordinator() -> Coordinator { Coordinator(model) }
    func makeUIView(context: Context) -> WKWebView {
        model.web.navigationDelegate = context.coordinator
        model.web.uiDelegate = context.coordinator
        return model.web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let model: CoachModel
        init(_ model: CoachModel) { self.model = model }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == "referee-coach.onrender.com" { decisionHandler(.allow) }
            else { decisionHandler(.cancel); if ["https", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) } }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { model.loadFailed = false }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { model.loadFailed = true }
        private func present(_ alert: UIAlertController) {
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  var controller = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
            while let presented = controller.presentedViewController { controller = presented }
            controller.present(alert, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: "جدول الحكم", message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "موافق", style: .default) { _ in completionHandler() }); present(a)
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: "تأكيد", message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "موافق", style: .default) { _ in completionHandler(true) }); present(a)
        }
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: "جدول الحكم", message: prompt, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText; $0.isSecureTextEntry = prompt.contains("رمز") }
            a.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "موافق", style: .default) { _ in completionHandler(a.textFields?.first?.text) }); present(a)
        }
    }
}

struct ToolsView: View {
    @ObservedObject var model: CoachModel
    @Environment(\.dismiss) var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section("الصحة") {
                    Text("الاستيراد يقرأ ما تسمح به من صحتي ويرسله إلى خادمك الحالي ليستفيد منه المدرب. لا يكتب تمارين الجري إلى صحتي.").font(.footnote)
                    Button(model.busy ? "جارٍ الاستيراد…" : "السماح بالصحة واستيراد البيانات") { Task { await model.importHealth() } }.disabled(model.busy)
                    if let date = UserDefaults.standard.object(forKey: "last-health-import") as? Date { Text("آخر استيراد: \(date.formatted())").font(.footnote) }
                    if !model.message.isEmpty { Text(model.message).font(.footnote) }
                    if !model.healthSummary.isEmpty { Text(model.healthSummary).font(.footnote) }
                    Text("إذا بيانات قارمن ناقصة، افتح Garmin Connect وانتظر مزامنة صحتي ثم أعد الاستيراد.").font(.footnote)
                }
                NavigationLink("تسجيل الجري وسجل التمارين") { RunView(recorder: model.run) }
                NavigationLink("تعديل التذكيرات") { ReminderView(store: model.reminders) }
            }
            .navigationTitle("أدوات الآيفون")
            .toolbar { Button("تم") { dismiss() } }
        }.environment(\.layoutDirection, .rightToLeft)
    }
}

final class HealthReader {
    let store = HKHealthStore()
    let iso = ISO8601DateFormatter()
    func samples(_ type: HKSampleType, since: Date, limit: Int = HKObjectQueryNoLimit) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<[HKSample], Error>) in
            let q = HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: since, end: Date()), limit: limit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, data, error in
                if let error { c.resume(throwing: error) } else { c.resume(returning: data ?? []) }
            }; store.execute(q)
        }
    }
    func total(_ type: HKQuantityType, start: Date, end: Date, unit: HKUnit) async throws -> Double? {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Double?, Error>) in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate), options: .cumulativeSum) { _, result, error in
                if let error { c.resume(throwing: error) } else { c.resume(returning: result?.sumQuantity()?.doubleValue(for: unit)) }
            }; store.execute(q)
        }
    }
    func read() async throws -> [String: Any] {
        guard HKHealthStore.isHealthDataAvailable() else { throw NSError(domain: "Health", code: 1, userInfo: [NSLocalizedDescriptionKey: "الصحة غير متاحة على هذا الجهاز"]) }
        let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        let hr = HKObjectType.quantityType(forIdentifier: .heartRate)!
        let rest = HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
        let steps = HKObjectType.quantityType(forIdentifier: .stepCount)!
        let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        let distance = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            store.requestAuthorization(toShare: [], read: [sleep, hr, rest, steps, energy, distance, HKObjectType.workoutType()]) { ok, error in
                if let error { c.resume(throwing: error) } else if ok { c.resume() } else { c.resume(throwing: NSError(domain: "تعذر طلب صلاحيات الصحة", code: 2)) }
            }
        }
        let since = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
        let sleepRows = try await samples(sleep, since: since, limit: 3000).compactMap { $0 as? HKCategorySample }
        let hrRows = try await samples(hr, since: since, limit: 6000).compactMap { $0 as? HKQuantitySample }
        let workouts = try await samples(HKObjectType.workoutType(), since: since, limit: 20).compactMap { $0 as? HKWorkout }
        let rests = try await samples(rest, since: since, limit: 1).compactMap { $0 as? HKQuantitySample }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        var dayRows: [[String: Any]] = []
        for n in 0..<7 {
            let start = Calendar.current.startOfDay(for: Calendar.current.date(byAdding: .day, value: -n, to: Date())!)
            let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
            if let value = try await total(steps, start: start, end: end, unit: .count()) { dayRows.append(["date": iso.string(from: start), "value": value]) }
        }
        var payload: [String: Any] = [
            "sleep": sleepRows.map { ["start": iso.string(from: $0.startDate), "end": iso.string(from: $0.endDate), "value": $0.value] as [String: Any] },
            "steps": dayRows,
            "workouts": workouts.map { w -> [String: Any] in
                let type: String
                switch w.workoutActivityType { case .running: type = "running"; case .walking: type = "walking"; case .cycling: type = "cycling"; case .soccer: type = "soccer"; case .traditionalStrengthTraining, .functionalStrengthTraining: type = "strength"; default: type = "other" }
                let rates = hrRows.filter { $0.startDate >= w.startDate && $0.startDate <= w.endDate }
                var row: [String: Any] = ["start": iso.string(from: w.startDate), "end": iso.string(from: w.endDate), "type": type, "duration_min": w.duration / 60, "hr": rates.map { ["date": iso.string(from: $0.startDate), "value": $0.quantity.doubleValue(for: bpm)] as [String: Any] }]
                if let d = w.totalDistance { row["distance_km"] = d.doubleValue(for: .meterUnit(with: .kilo)) }
                return row
            }
        ]
        if let r = rests.first { payload["resting_hr"] = r.quantity.doubleValue(for: bpm) }
        let start = Calendar.current.startOfDay(for: Date())
        var summary: [String] = []
        if let kcal = try await total(energy, start: start, end: Date(), unit: .kilocalorie()) { summary.append("طاقة النشاط اليوم: \(Int(kcal)) سعرة") }
        if let km = try await total(distance, start: start, end: Date(), unit: .meterUnit(with: .kilo)) { summary.append(String(format: "المشي والجري اليوم: %.2f كم", km)) }
        if let latest = hrRows.first { summary.append("آخر نبض متاح: \(Int(latest.quantity.doubleValue(for: bpm))) — \(latest.startDate.formatted())") }
        payload["summary"] = summary.joined(separator: "\n")
        return payload
    }
}
