import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Transparent local answer-scoring reference for the InterVox prototype.
 * Usage: java InterviewScorer <question-index> "<answer>"
 */
public final class InterviewScorer {
  private static final String[][] FOCUS_TERMS = {
      {"experience", "work", "learn", "goal", "skill", "interest"},
      {"company", "problem", "impact", "team", "field", "mission"},
      {"clarify", "question", "requirement", "stakeholder", "plan", "communicate"},
      {"change", "improve", "lesson", "learn", "result", "reflect"}
  };

  private InterviewScorer() {}

  public static int clamp(int value, int minimum, int maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  public static String score(int questionIndex, String answer) {
    String clean = answer == null ? "" : answer.trim();
    String normalized = clean.toLowerCase(Locale.ROOT);
    String[] words = clean.isEmpty() ? new String[0] : clean.split("\\s+");
    int wordCount = words.length;
    Set<String> vocabulary = new HashSet<>(Arrays.asList(words));
    int relevantTerms = 0;
    for (String term : FOCUS_TERMS[Math.max(0, Math.min(FOCUS_TERMS.length - 1, questionIndex))]) {
      if (normalized.contains(term)) relevantTerms++;
    }

    int detail = Math.min(22, wordCount / 4);
    int brevityPenalty = wordCount < 12 ? 15 : 0;
    int correctness = clamp(37 + detail + Math.min(28, relevantTerms * 6)
        + (questionIndex == 2 && wordCount > 28 ? 12 : 0)
        + (wordCount > 55 ? 8 : 0) - brevityPenalty, 20, 95);
    int confidence = Math.min(94, 50 + Math.min(35, wordCount / 3));
    int vocabularyScore = Math.min(93, 44 + Math.min(42, vocabulary.size()));
    int communication = Math.min(95, 49 + Math.min(38, wordCount / 3)
        + (clean.matches(".*[,.].*") ? 5 : 0));
    int overall = Math.round((correctness + confidence + vocabularyScore + communication) / 4.0f);

    return String.format(Locale.ROOT,
        "{\"correctness\":%d,\"confidence\":%d,\"vocabulary\":%d,\"communication\":%d,\"overall\":%d}",
        correctness, confidence, vocabularyScore, communication, overall);
  }

  public static void main(String[] args) {
    if (args.length < 2) {
      System.err.println("Usage: java InterviewScorer <question-index> \"<answer>\"");
      System.exit(2);
    }
    System.out.println(score(Integer.parseInt(args[0]), args[1]));
  }
}