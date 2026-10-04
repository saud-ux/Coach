import SwiftUI
import CoreLocation
import MapKit

struct TrackPoint: Codable {
    var lat: Double
    var lon: Double
    var date: Date
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}
struct RecordedRun: Identifiable, Codable {
    var id = UUID()
    var start: Date
    var end: Date?
    var meters = 0.0
    var points: [TrackPoint] = []
}
@MainActor final class RunRecorder: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var active: RecordedRun?
    @Published var runs: [RecordedRun] = []
    @Published var recording = false
    @Published var message = ""
    private let location = CLLocationManager()
    private var previous: CLLocation?
    private var startPending = false
    private let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    override init() {
        super.init()
        location.delegate = self
        location.activityType = .fitness
        location.desiredAccuracy = kCLLocationAccuracyBest
        location.distanceFilter = 5
        location.pausesLocationUpdatesAutomatically = false
        location.allowsBackgroundLocationUpdates = true
        location.showsBackgroundLocationIndicator = true
        if let d = try? Data(contentsOf: folder.appendingPathComponent("runs.json")) { runs = (try? JSONDecoder().decode([RecordedRun].self, from: d)) ?? [] }
        if let d = try? Data(contentsOf: folder.appendingPathComponent("active-run.json")) { active = try? JSONDecoder().decode(RecordedRun.self, from: d); message = "وجدنا جلسة محفوظة. احفظها أو استأنف التسجيل؛ الفترة التي كان التطبيق مغلقًا فيها لا تحتوي مسارًا." }
    }
    func start() {
        guard !recording else { return }
        switch location.authorizationStatus {
        case .notDetermined: startPending = true; location.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            if active == nil { active = RecordedRun(start: Date()) }
            previous = nil; recording = true; message = "بانتظار إشارة GPS دقيقة…"
            location.startUpdatingLocation(); checkpoint()
        default: message = "فعّل صلاحية الموقع من إعدادات الآيفون."
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if startPending && [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) { startPending = false; start() }
        if [.denied, .restricted].contains(manager.authorizationStatus) { startPending = false; recording = false; previous = nil; manager.stopUpdatingLocation(); message = "صلاحية الموقع غير متاحة." }
    }
    func pause() { location.stopUpdatingLocation(); recording = false; previous = nil; checkpoint() }
    func finish() {
        guard var run = active else { return }
        pause(); run.end = Date(); runs.insert(run, at: 0)
        do {
            try JSONEncoder().encode(runs).write(to: folder.appendingPathComponent("runs.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            active = nil; try? FileManager.default.removeItem(at: folder.appendingPathComponent("active-run.json")); message = "تم حفظ الجري داخل التطبيق."
        } catch { runs.removeFirst(); message = "تعذر الحفظ: \(error.localizedDescription)" }
    }
    private func checkpoint() {
        guard let active else { return }
        do { try JSONEncoder().encode(active).write(to: folder.appendingPathComponent("active-run.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        catch { message = "تعذر حفظ الجلسة: \(error.localizedDescription)" }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard recording, active != nil else { return }
        for point in locations {
            guard point.horizontalAccuracy >= 0, point.horizontalAccuracy <= 25,
                  abs(point.timestamp.timeIntervalSinceNow) < 15 else { continue }
            if let previous {
                let dt = point.timestamp.timeIntervalSince(previous.timestamp)
                guard dt > 0 else { continue }
                let distance = point.distance(from: previous)
                if dt <= 30, distance / dt > 12 { continue }
                // Do not draw missing periods as measured distance.
                if dt <= 30 { active?.meters += distance }
            }
            active?.points.append(TrackPoint(lat: point.coordinate.latitude, lon: point.coordinate.longitude, date: point.timestamp))
            previous = point; message = "جاري التسجيل — دقة GPS \(Int(point.horizontalAccuracy)) م"
        }
        checkpoint()
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { message = "GPS: \(error.localizedDescription)" }
    var exportURL: URL { folder.appendingPathComponent("runs.json") }
}

struct RunView: View {
    @ObservedObject var recorder: RunRecorder
    var body: some View {
        List {
            Section("الجلسة الحالية") {
                if let run = recorder.active {
                    Text(String(format: "%.2f كم", run.meters / 1000)).font(.largeTitle)
                    Text("البداية: \(run.start.formatted())")
                    Text("المدة المعروضة تشمل التوقف المؤقت.").font(.footnote)
                    TimelineView(.periodic(from: .now, by: 1)) { context in Text("\(Int(context.date.timeIntervalSince(run.start) / 60)) دقيقة") }
                    Button(recorder.recording ? "إيقاف مؤقت" : "استئناف") { if recorder.recording { recorder.pause() } else { recorder.start() } }
                    Button("إنهاء وحفظ") { recorder.finish() }
                } else { Button("ابدأ الجري") { recorder.start() } }
                Text(recorder.message).font(.footnote)
                Text("يستمر التسجيل مع قفل الشاشة. إغلاق التطبيق بالقوة يوقف GPS؛ تبقى آخر نقاط محفوظة. لا نكتب الجري إلى Apple Health.").font(.footnote)
            }
            Section("سجل الجري") {
                ForEach(recorder.runs) { run in
                    NavigationLink { RunDetail(run: run) } label: {
                        VStack(alignment: .leading) { Text(run.start.formatted()); Text(String(format: "%.2f كم", run.meters / 1000)) }
                    }
                }
                if !recorder.runs.isEmpty { ShareLink("تصدير سجل الجري", item: recorder.exportURL) }
            }
        }.navigationTitle("الجري")
    }
}
struct RunDetail: View {
    let run: RecordedRun
    var body: some View {
        VStack {
            Text(String(format: "%.2f كم", run.meters / 1000)).font(.largeTitle)
            Map {
                MapPolyline(coordinates: run.points.map(\.coordinate)).stroke(.green, lineWidth: 4)
            }
            Text("المسار يُحفظ على جهازك؛ عرض الخريطة يحتاج اتصالًا بالإنترنت.").font(.footnote).padding()
        }.navigationTitle("مسار الجري")
    }
}
