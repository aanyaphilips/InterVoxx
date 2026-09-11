#include <algorithm>
#include <cctype>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

struct VoiceMetrics {
  int words = 0;
  int fillerWords = 0;
  double wordsPerMinute = 0.0;
  int confidence = 50;
};

static std::string lower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

static VoiceMetrics analyze(double durationSeconds, const std::string& transcript) {
  std::istringstream stream(transcript);
  std::string word;
  std::vector<std::string> words;
  const std::unordered_set<std::string> fillers = {"um", "uh", "like", "basically", "actually"};

  while (stream >> word) {
    word.erase(std::remove_if(word.begin(), word.end(),
                              [](unsigned char c) { return std::ispunct(c); }),
               word.end());
    if (!word.empty()) words.push_back(lower(word));
  }

  int fillerCount = 0;
  for (const auto& item : words) {
    if (fillers.count(item)) fillerCount++;
  }

  const double safeDuration = std::max(1.0, durationSeconds);
  const double wpm = static_cast<double>(words.size()) / safeDuration * 60.0;
  const int paceSignal = std::min(28, static_cast<int>(std::abs(wpm - 135.0) / 4.0));
  const int fillerPenalty = std::min(25, fillerCount * 5);

  VoiceMetrics result;
  result.words = static_cast<int>(words.size());
  result.fillerWords = fillerCount;
  result.wordsPerMinute = wpm;
  result.confidence = std::max(20, std::min(95, 88 - paceSignal - fillerPenalty));
  return result;
}

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cerr << "Usage: VoiceMetrics <duration-seconds> \"<transcript>\"\n";
    return 2;
  }

  std::string transcript = argv[2];
  for (int i = 3; i < argc; i++) transcript += " " + std::string(argv[i]);
  const VoiceMetrics result = analyze(std::stod(argv[1]), transcript);

  std::cout << std::fixed << std::setprecision(1)
            << "{\"words\":" << result.words
            << ",\"fillerWords\":" << result.fillerWords
            << ",\"wordsPerMinute\":" << result.wordsPerMinute
            << ",\"confidence\":" << result.confidence << "}\n";
  return 0;
}