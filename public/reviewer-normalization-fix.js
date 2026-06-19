(() => {
  const recalculateWithReviewerState = App.recalculateReadinessScore;

  App.recalculateReadinessScore = function normalizeBeforeReviewerScoring() {
    if (this.currentResult && Array.isArray(this.currentResult.risks)) {
      this.currentResult.risks.forEach(risk => {
        if (!risk.status) risk.status = 'open';

        if (!risk.ownerStatus) {
          risk.ownerStatus = risk.accountabilityStatus === 'confirmed'
            ? 'confirmed'
            : 'unconfirmed';
        }

        if (typeof risk.suggestedOwner !== 'string') {
          risk.suggestedOwner = Array.isArray(risk.affectedStakeholders)
            ? (risk.affectedStakeholders[0] || '')
            : '';
        }
      });
    }

    return recalculateWithReviewerState.call(this);
  };
})();
