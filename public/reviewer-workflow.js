(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

  const core = {
    init: App.init,
    bindEvents: App.bindEvents,
    runScanPipeline: App.runScanPipeline,
    recalculateReadinessScore: App.recalculateReadinessScore,
    renderDashboard: App.renderDashboard,
    syncPrintAdvisoryMemo: App.syncPrintAdvisoryMemo
  };

  App.previousResult = null;
  App.comparison = null;
  App.toastTimer = null;

  App.installReviewerUI = function installReviewerUI() {
    if (!document.querySelector('link[href="reviewer-workflow.css"]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'reviewer-workflow.css';
      document.head.appendChild(stylesheet);
    }

    const header = document.querySelector('.header-controls');
    if (header && !document.getElementById('btn-download-json')) {
      const download = document.createElement('button');
      download.id = 'btn-download-json';
      download.type = 'button';
      download.className = 'btn btn-secondary';
      download.textContent = 'Download Registry';
      download.disabled = true;

      const copy = document.createElement('button');
      copy.id = 'btn-copy-md';
      copy.type = 'button';
      copy.className = 'btn btn-secondary';
      copy.textContent = 'Copy Markdown Brief';
      copy.disabled = true;

      header.insertBefore(copy, header.firstChild);
      header.insertBefore(download, copy);
    }

    const form = document.querySelector('.input-form');
    const sourceLabel = document.querySelector('label[for="doc-text"]');
    if (form && sourceLabel && !document.getElementById('dropzone')) {
      const dropzone = document.createElement('div');
      dropzone.id = 'dropzone';
      dropzone.className = 'dropzone-area';
      dropzone.tabIndex = 0;
      dropzone.setAttribute('role', 'button');
      dropzone.setAttribute('aria-label', 'Import a text, Markdown, or saved RiskScan registry file');
      dropzone.innerHTML = `
        <div class="dropzone-text">
          <strong>Drop a plan or saved registry here</strong>
          <span>.txt, .md, or RiskScan .json</span>
          <button type="button" class="btn-link" id="btn-browse">Browse files</button>
        </div>
        <input type="file" id="file-input" hidden accept=".txt,.md,.json,text/plain,text/markdown,application/json">
      `;
      form.insertBefore(dropzone, sourceLabel);
    }

    const risksPanel = document.getElementById('sec-risks');
    if (risksPanel && !document.getElementById('comparison-banner')) {
      const banner = document.createElement('section');
      banner.id = 'comparison-banner';
      banner.className = 'comparison-banner';
      banner.hidden = true;
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = `
        <div>
          <strong>Scan comparison</strong>
          <p id="comparison-text"></p>
          <div id="comparison-resolved-list" class="comparison-resolved-list"></div>
        </div>
        <button class="btn-clear-comp" id="btn-clear-comparison" type="button" aria-label="Clear scan comparison">×</button>
      `;
      risksPanel.insertBefore(banner, risksPanel.firstChild);
    }

    if (!document.getElementById('toast-notification')) {
      const toast = document.createElement('div');
      toast.id = 'toast-notification';
      toast.className = 'toast';
      toast.hidden = true;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
  };

  App.init = async function reviewerInit() {
    this.installReviewerUI();
    await core.init.call(this);
    this.updateExportButtons();
  };

  App.bindEvents = function reviewerBindEvents() {
    core.bindEvents.call(this);

    document.getElementById('btn-download-json').addEventListener('click', () => this.downloadRegistry());
    document.getElementById('btn-copy-md').addEventListener('click', () => this.copyMarkdownBrief());
    document.getElementById('btn-clear-comparison').addEventListener('click', () => this.clearComparison());

    const riskContainer = document.getElementById('risk-cards-body');
    riskContainer.addEventListener('change', event => this.handleReviewerControl(event));

    document.querySelector('.dependency-grid').addEventListener('click', event => {
      const button = event.target.closest('[data-dependency-name]');
      if (button) {
        event.preventDefault();
        this.toggleDependencyStatus(button.dataset.dependencyName);
      }
    });

    this.bindFileIntake();
  };

  App.bindFileIntake = function bindFileIntake() {
    const dropzone = document.getElementById('dropzone');
    const input = document.getElementById('file-input');
    const browse = document.getElementById('btn-browse');

    browse.addEventListener('click', event => {
      event.stopPropagation();
      input.click();
    });
    dropzone.addEventListener('click', event => {
      if (event.target !== browse) input.click();
    });
    dropzone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });

    ['dragenter', 'dragover'].forEach(type => {
      dropzone.addEventListener(type, event => {
        event.preventDefault();
        dropzone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(type => {
      dropzone.addEventListener(type, event => {
        event.preventDefault();
        dropzone.classList.remove('drag-over');
      });
    });

    dropzone.addEventListener('drop', event => {
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) this.importFile(file);
    });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) this.importFile(file);
      input.value = '';
    });
  };

  App.runScanPipeline = async function reviewerRunScanPipeline() {
    const priorResult = this.currentResult ? clone(this.currentResult) : null;
    const priorObject = this.currentResult;
    await core.runScanPipeline.call(this);

    if (this.currentResult && this.currentResult !== priorObject) {
      this.previousResult = priorResult;
      this.comparison = priorResult
        ? this.processComparison(this.currentResult, priorResult)
        : null;
      this.renderDashboard();
      this.showToast('Analysis ready for reviewer decisions.');
    }
  };

  App.recalculateReadinessScore = function reviewerRecalculate() {
    if (!this.currentResult) return;
    const result = window.ScoringEngine.calculateScore(this.currentResult, this.config);
    this.currentResult.computedScore = result.finalScore;
    this.currentResult.calculatedScore = result.calculatedScore;
    this.currentResult.gateCap = result.gateCap;
    this.currentResult.gateAdjustment = result.gateAdjustment;
    this.currentResult.gateReason = result.gateReason;
    this.currentResult.gateApplied = result.gateAdjustment > 0;
    this.currentResult.computedClassification = result.classification;
    this.currentResult.computedPenalties = result.penaltiesList;
    this.currentResult.computedRiskAssessments = result.riskAssessments;

    (this.currentResult.risks || []).forEach(risk => {
      if (!risk.status) risk.status = 'open';
      if (!risk.ownerStatus) {
        risk.ownerStatus = risk.accountabilityStatus === 'confirmed' ? 'confirmed' : 'unconfirmed';
      }
      if (typeof risk.suggestedOwner !== 'string') {
        risk.suggestedOwner = Array.isArray(risk.affectedStakeholders)
          ? (risk.affectedStakeholders[0] || '')
          : '';
      }
    });

    this.updateExportButtons();
  };

  App.renderDashboard = function reviewerRenderDashboard() {
    core.renderDashboard.call(this);
    this.renderComparison();
    this.updateExportButtons();
  };

  App.assessmentForRisk = function assessmentForRisk(risk, index) {
    const key = risk.id || risk.tempId || `risk-${index + 1}`;
    return (
      this.currentResult.computedRiskAssessments &&
      this.currentResult.computedRiskAssessments[key]
    ) || window.ScoringEngine.getRiskAssessment(risk);
  };

  App.renderRiskRegister = function reviewerRenderRiskRegister() {
    const body = document.getElementById('risk-cards-body');
    body.innerHTML = '';

    const filterSeverity = document.getElementById('filter-severity').value;
    const filterCategory = document.getElementById('filter-category').value;
    const filterStatus = document.getElementById('filter-status').value;

    this.currentResult.risks.forEach((risk, index) => {
      const assessment = this.assessmentForRisk(risk, index);
      if (filterSeverity !== 'all' && assessment.finalSeverity !== filterSeverity) return;
      if (filterCategory !== 'all' && risk.category !== filterCategory) return;
      if (filterStatus !== 'all' && risk.status !== filterStatus) return;

      const card = document.createElement('article');
      card.className = `risk-card severity-${assessment.finalSeverity}`;
      card.dataset.riskIndex = index;

      const comparisonStatus = this.comparison && this.comparison.currentStatus.get(this.riskKey(risk));
      const comparisonBadge = comparisonStatus === 'new'
        ? '<span class="badge comparison-new">NEW</span>'
        : comparisonStatus === 'active'
          ? '<span class="badge comparison-active">ACTIVE</span>'
          : '';

      const overrideBadges = [
        assessment.severityOverrideApplied ? '<span class="badge override-badge">Severity overridden</span>' : '',
        assessment.launchOverrideApplied ? '<span class="badge override-badge">Launch gate overridden</span>' : '',
        assessment.progressionOverrideApplied ? '<span class="badge override-badge">Progression gate overridden</span>' : ''
      ].join('');

      const evidence = (risk.evidence || []).map(item => `
        <div class="evidence-quote">
          “${escapeHTML(item.excerpt)}” — <strong>${escapeHTML(item.sourceReference)}</strong>
        </div>
      `).join('');

      const codes = (risk.conditionCodes || []).map(code => `
        <span class="condition-code">${escapeHTML(code)}</span>
      `).join('') || '<span class="muted-small">None</span>';

      const stakeholderNames = this.stakeholderNames();
      const ownerIsCustom = Boolean(risk.suggestedOwner && !stakeholderNames.includes(risk.suggestedOwner));
      const hasValidationWarning =
        risk.status === 'resolved' && !window.ScoringEngine.isValidResolution(risk);

      card.innerHTML = `
        <div class="risk-card-header">
          <div class="risk-title-wrapper">
            <span class="badge ${['critical', 'high'].includes(assessment.finalSeverity) ? 'badge-red' : 'badge-amber'}">
              ${escapeHTML(assessment.finalSeverity)}
            </span>
            ${comparisonBadge}
            <h3>${escapeHTML(risk.title)}</h3>
          </div>
          <div class="risk-meta-badges">
            <span class="badge badge-purple">${escapeHTML(risk.category)}</span>
            <span class="badge badge-blue">Accountability: ${escapeHTML(risk.accountabilityStatus || 'unconfirmed')}</span>
            <span class="risk-confidence-badge">Confidence: ${Number.isFinite(risk.confidence) ? (risk.confidence * 100).toFixed(0) : '—'}%</span>
            ${overrideBadges}
          </div>
        </div>

        <div class="risk-card-body">
          <div class="risk-section-block">
            <strong>Implementation Impact</strong>
            <p>${escapeHTML(risk.implementationImpact || risk.businessImpact || '')}</p>
          </div>
          <div class="risk-section-block">
            <strong>Evidence</strong>
            ${evidence}
          </div>
          <div class="risk-section-block">
            <strong>Condition Codes</strong>
            <div class="condition-code-list">${codes}</div>
          </div>
          <div class="risk-section-block">
            <strong>Required Clarification or Action</strong>
            <p>${escapeHTML(risk.requiredClarificationOrAction || risk.recommendedAction || '')}</p>
          </div>

          <div class="calculation-strip">
            <span>Calculated severity: <strong>${escapeHTML(assessment.calculatedSeverity)}</strong></span>
            <span>Effective severity: <strong>${escapeHTML(assessment.finalSeverity)}</strong></span>
            <span>Launch blocker: <strong>${assessment.blocksLaunch ? 'Yes' : 'No'}</strong></span>
            <span>Progression blocker: <strong>${assessment.blocksProgression ? 'Yes' : 'No'}</strong></span>
          </div>

          ${hasValidationWarning ? `
            <div class="validation-warning">
              Resolution incomplete: a confirmed owner, resolution note, and resolution timestamp are required to clear penalties and gates.
            </div>
          ` : ''}
        </div>

        <div class="risk-card-footer reviewer-controls">
          <div class="control-grid">
            <div class="control-item">
              <label>Status</label>
              <select data-risk-field="status">
                ${this.reviewOption('open', 'Open', risk.status)}
                ${this.reviewOption('mitigating', 'Mitigating', risk.status)}
                ${this.reviewOption('resolved', 'Resolved', risk.status)}
                ${this.reviewOption('accepted', 'Accepted', risk.status)}
              </select>
            </div>

            <div class="control-item owner-control">
              <label>Assigned Owner</label>
              <select data-owner-select>
                ${this.ownerOptions(risk.suggestedOwner)}
                <option value="__custom__" ${ownerIsCustom ? 'selected' : ''}>Custom…</option>
              </select>
              <input
                data-risk-field="suggestedOwner"
                data-custom-owner
                type="text"
                maxlength="200"
                placeholder="Enter accountable owner"
                value="${escapeHTML(ownerIsCustom ? risk.suggestedOwner : '')}"
                ${ownerIsCustom ? '' : 'hidden'}
              >
              <label class="checkbox-label">
                <input data-risk-field="ownerStatus" type="checkbox" ${risk.ownerStatus === 'confirmed' ? 'checked' : ''}>
                Owner confirmed
              </label>
            </div>

            <div class="control-item">
              <label>Target Date</label>
              <input data-risk-field="targetDate" type="date" value="${escapeHTML(risk.targetDate || '')}">
            </div>

            <div class="control-item">
              <label>
                Severity Decision
                ${assessment.severityOverrideApplied ? '<span class="inline-override">Overridden</span>' : ''}
              </label>
              <select data-risk-field="severityOverride">
                ${this.reviewOption('', `Calculated (${assessment.calculatedSeverity})`, risk.severityOverride || '')}
                ${this.reviewOption('critical', 'Critical', risk.severityOverride || '')}
                ${this.reviewOption('high', 'High', risk.severityOverride || '')}
                ${this.reviewOption('medium', 'Medium', risk.severityOverride || '')}
                ${this.reviewOption('low', 'Low', risk.severityOverride || '')}
              </select>
            </div>

            <div class="control-item">
              <label>
                Launch Blocker
                ${assessment.launchOverrideApplied ? '<span class="inline-override">Overridden</span>' : ''}
              </label>
              <select data-risk-field="blocksLaunchOverride">
                ${this.reviewOption('', `Calculated (${assessment.calculatedBlocksLaunch ? 'Blocked' : 'Not blocked'})`, this.booleanOverrideValue(risk.blocksLaunchOverride))}
                ${this.reviewOption('true', 'Force blocked', this.booleanOverrideValue(risk.blocksLaunchOverride))}
                ${this.reviewOption('false', 'Force not blocked', this.booleanOverrideValue(risk.blocksLaunchOverride))}
              </select>
            </div>

            <div class="control-item">
              <label>
                Progression Blocker
                ${assessment.progressionOverrideApplied ? '<span class="inline-override">Overridden</span>' : ''}
              </label>
              <select data-risk-field="blocksProgressionOverride">
                ${this.reviewOption('', `Calculated (${assessment.calculatedBlocksProgression ? 'Blocked' : 'Not blocked'})`, this.booleanOverrideValue(risk.blocksProgressionOverride))}
                ${this.reviewOption('true', 'Force blocked', this.booleanOverrideValue(risk.blocksProgressionOverride))}
                ${this.reviewOption('false', 'Force not blocked', this.booleanOverrideValue(risk.blocksProgressionOverride))}
              </select>
            </div>

            <div class="control-item control-wide">
              <label>Reviewer Override Rationale</label>
              <input
                data-risk-field="overrideReason"
                type="text"
                maxlength="2000"
                placeholder="Explain why the calculated result was changed"
                value="${escapeHTML(risk.overrideReason || '')}"
              >
            </div>

            <div class="control-item control-wide">
              <label>Resolution Note</label>
              <input
                data-risk-field="resolutionNote"
                type="text"
                maxlength="2000"
                placeholder="Document evidence that closes or accepts this risk"
                value="${escapeHTML(risk.resolutionNote || '')}"
              >
            </div>
          </div>
          ${risk.overrideUpdatedAt ? `<small class="override-timestamp">Last reviewer override: ${escapeHTML(this.formatDateTime(risk.overrideUpdatedAt))}</small>` : ''}
        </div>
      `;

      body.appendChild(card);
    });

    if (!body.children.length) {
      body.innerHTML = '<p class="empty-filter-result">No risks match the selected filters.</p>';
    }
  };

  App.reviewOption = function reviewOption(value, label, currentValue) {
    return `<option value="${escapeHTML(value)}" ${String(value) === String(currentValue) ? 'selected' : ''}>${escapeHTML(label)}</option>`;
  };

  App.booleanOverrideValue = function booleanOverrideValue(value) {
    return typeof value === 'boolean' ? String(value) : '';
  };

  App.stakeholderNames = function stakeholderNames() {
    return [...new Set((this.currentResult.stakeholders || []).map(item => item.name).filter(Boolean))];
  };

  App.ownerOptions = function ownerOptions(currentOwner) {
    const names = this.stakeholderNames();
    const options = ['<option value="">Unassigned</option>'];
    names.forEach(name => {
      options.push(
        `<option value="${escapeHTML(name)}" ${name === currentOwner ? 'selected' : ''}>${escapeHTML(name)}</option>`
      );
    });
    return options.join('');
  };

  App.handleReviewerControl = function handleReviewerControl(event) {
    const card = event.target.closest('[data-risk-index]');
    if (!card) return;
    const index = Number(card.dataset.riskIndex);

    if (event.target.matches('[data-owner-select]')) {
      const customInput = card.querySelector('[data-custom-owner]');
      if (event.target.value === '__custom__') {
        customInput.hidden = false;
        customInput.focus();
        return;
      }
      customInput.hidden = true;
      customInput.value = '';
      this.updateRiskField(index, 'suggestedOwner', event.target.value);
      return;
    }

    const field = event.target.dataset.riskField;
    if (!field) return;

    let value;
    if (field === 'ownerStatus') {
      value = event.target.checked ? 'confirmed' : 'unconfirmed';
    } else if (field === 'blocksLaunchOverride' || field === 'blocksProgressionOverride') {
      value = event.target.value === '' ? undefined : event.target.value === 'true';
    } else {
      value = event.target.value;
    }

    this.updateRiskField(index, field, value);
  };

  App.updateRiskField = function reviewerUpdateRiskField(index, field, value) {
    if (!this.currentResult || !this.currentResult.risks[index]) return;
    const risk = this.currentResult.risks[index];
    const removableFields = new Set([
      'severityOverride', 'blocksLaunchOverride', 'blocksProgressionOverride',
      'targetDate', 'overrideReason'
    ]);

    if (removableFields.has(field) && (value === undefined || value === null || value === '')) {
      delete risk[field];
    } else {
      risk[field] = value;
    }

    if (['severityOverride', 'blocksLaunchOverride', 'blocksProgressionOverride', 'overrideReason'].includes(field)) {
      risk.overrideUpdatedAt = new Date().toISOString();
    }

    if (field === 'status' && value === 'resolved') {
      risk.resolvedAt = new Date().toISOString();
      if (!risk.resolutionNote) {
        risk.resolutionNote = `Resolved during reviewer workflow on ${new Date().toLocaleString()}`;
      }
    } else if (field === 'status' && value !== 'resolved') {
      delete risk.resolvedAt;
    }

    this.recalculateReadinessScore();
    this.renderDashboard();
  };

  App.toggleDependencyStatus = function reviewerToggleDependency(name) {
    if (!this.currentResult) return;
    const dependency = this.currentResult.dependencies.find(item => item.name === name);
    if (!dependency) return;
    dependency.status = dependency.status === 'resolved' ? 'missing' : 'resolved';
    this.recalculateReadinessScore();
    this.renderDashboard();
  };

  App.riskKey = function riskKey(risk) {
    if (risk && typeof risk.id === 'string' && risk.id.trim()) return `id:${risk.id}`;
    const canonical = [
      risk.category || '',
      this.normalizeRiskText(risk.title || ''),
      [...(risk.conditionCodes || [])].sort().join('|'),
      risk.affectedScope || '',
      risk.affectedStage || ''
    ].join('::');
    return `fp:${this.fnv1a(canonical)}`;
  };

  App.normalizeRiskText = value =>
    String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  App.fnv1a = function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  App.processComparison = function processComparison(newResult, oldResult) {
    const oldMap = new Map((oldResult.risks || []).map(risk => [this.riskKey(risk), risk]));
    const newMap = new Map((newResult.risks || []).map(risk => [this.riskKey(risk), risk]));
    const currentStatus = new Map();

    newMap.forEach((risk, key) => {
      currentStatus.set(key, oldMap.has(key) ? 'active' : 'new');
    });

    const resolved = [];
    oldMap.forEach((risk, key) => {
      if (!newMap.has(key)) resolved.push(clone(risk));
    });

    return {
      currentStatus,
      newCount: [...currentStatus.values()].filter(value => value === 'new').length,
      maintainedCount: [...currentStatus.values()].filter(value => value === 'active').length,
      resolved
    };
  };

  App.renderComparison = function renderComparison() {
    const banner = document.getElementById('comparison-banner');
    if (!banner) return;

    if (!this.comparison) {
      banner.hidden = true;
      return;
    }

    banner.hidden = false;
    document.getElementById('comparison-text').textContent =
      `Since the previous scan: ${this.comparison.newCount} new, ` +
      `${this.comparison.resolved.length} removed or resolved, ` +
      `${this.comparison.maintainedCount} maintained.`;

    const resolvedBody = document.getElementById('comparison-resolved-list');
    resolvedBody.innerHTML = '';
    if (this.comparison.resolved.length) {
      const label = document.createElement('span');
      label.textContent = 'Recently removed or resolved:';
      const list = document.createElement('ul');
      this.comparison.resolved.forEach(risk => {
        const item = document.createElement('li');
        item.textContent = risk.title;
        list.appendChild(item);
      });
      resolvedBody.appendChild(label);
      resolvedBody.appendChild(list);
    }
  };

  App.clearComparison = function clearComparison() {
    this.previousResult = null;
    this.comparison = null;
    this.renderComparison();
    if (this.currentResult) this.renderRiskRegister();
  };

  App.importFile = async function importFile(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      this.showToast('File exceeds the 5 MB import limit.', 'error');
      return;
    }

    const extension = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'md', 'json'].includes(extension)) {
      this.showToast('Unsupported file type. Use .txt, .md, or .json.', 'error');
      return;
    }

    try {
      const content = await file.text();
      if (extension !== 'json') {
        document.getElementById('doc-text').value = content;
        document.querySelectorAll('.btn-preset').forEach(button => button.classList.remove('active-preset'));
        this.activeScenarioId = null;
        this.showToast(`${file.name} loaded into the source document.`);
        return;
      }

      const parsed = JSON.parse(content);
      const imported = window.ValidationEngine.normalizeRegistryImport(parsed, this.config);
      this.previousResult = null;
      this.comparison = null;
      this.originalResult = clone(imported.result);
      this.currentResult = clone(imported.result);

      if (imported.metadata.projectName) {
        document.getElementById('project-name').value = imported.metadata.projectName;
      }
      const profile = document.getElementById('analysis-profile');
      if (
        imported.metadata.analysisProfile &&
        [...profile.options].some(option => option.value === imported.metadata.analysisProfile)
      ) {
        profile.value = imported.metadata.analysisProfile;
      }
      if (imported.metadata.sourceText) {
        document.getElementById('doc-text').value = imported.metadata.sourceText;
      }

      document.querySelectorAll('.btn-preset').forEach(button => button.classList.remove('active-preset'));
      this.activeScenarioId = null;
      this.recalculateReadinessScore();
      this.renderDashboard();
      document.getElementById('results-empty').style.display = 'none';
      document.getElementById('results-dashboard').style.display = 'block';
      this.showToast('Saved reviewer registry imported and validated.');
    } catch (error) {
      console.error(error);
      this.showToast(`Registry import rejected: ${error.message}`, 'error');
    }
  };

  App.exportableResult = function exportableResult() {
    const result = clone(this.currentResult);
    delete result.computedRiskAssessments;
    return result;
  };

  App.downloadRegistry = function downloadRegistry() {
    if (!this.currentResult) return;
    const envelope = {
      exportFormat: 'risk-scan-registry',
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      projectName: document.getElementById('project-name').value.trim(),
      analysisProfile: document.getElementById('analysis-profile').value,
      sourceText: document.getElementById('doc-text').value,
      result: this.exportableResult()
    };

    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.safeFilename(envelope.projectName || 'risk-scan')}-registry.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.showToast('Reviewer registry downloaded.');
  };

  App.safeFilename = value =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'risk-scan';

  App.buildMarkdownBrief = function buildMarkdownBrief() {
    const result = this.currentResult;
    const projectName = document.getElementById('project-name').value.trim() || 'Untitled implementation';
    const lines = [
      `# Implementation Readiness Brief — ${projectName}`,
      '',
      `**Readiness score:** ${result.computedScore}/100`,
      `**Classification:** ${result.computedClassification.label}`,
      `**Calculated score before gates:** ${result.calculatedScore}/100`,
      `**Gate cap:** ${result.gateCap}/100`,
      `**Assessment date:** ${new Date().toISOString().slice(0, 10)}`,
      '',
      '## Executive Summary',
      '',
      result.summary,
      ''
    ];

    if (result.gateApplied) {
      lines.push('## Active Gate', '', result.gateReason, '');
    }

    if (this.comparison) {
      lines.push(
        '## Change Since Previous Scan',
        '',
        `- New risks: ${this.comparison.newCount}`,
        `- Removed or resolved risks: ${this.comparison.resolved.length}`,
        `- Maintained risks: ${this.comparison.maintainedCount}`,
        ''
      );
    }

    lines.push('## Active Risk Register', '');
    result.risks
      .filter(risk => !window.ScoringEngine.isValidResolution(risk))
      .forEach((risk, index) => {
        const assessment = this.assessmentForRisk(risk, index);
        lines.push(
          `### ${risk.title}`,
          '',
          `- **Category:** ${risk.category}`,
          `- **Effective severity:** ${assessment.finalSeverity}${assessment.severityOverrideApplied ? ` (reviewer override; calculated ${assessment.calculatedSeverity})` : ''}`,
          `- **Status:** ${risk.status}`,
          `- **Launch blocker:** ${assessment.blocksLaunch ? 'Yes' : 'No'}${assessment.launchOverrideApplied ? ' (overridden)' : ''}`,
          `- **Progression blocker:** ${assessment.blocksProgression ? 'Yes' : 'No'}${assessment.progressionOverrideApplied ? ' (overridden)' : ''}`,
          `- **Owner:** ${risk.suggestedOwner || 'Unassigned'}${risk.ownerStatus === 'confirmed' ? ' (confirmed)' : ''}`,
          `- **Target date:** ${risk.targetDate || 'Not assigned'}`,
          `- **Impact:** ${risk.implementationImpact || risk.businessImpact || ''}`,
          `- **Required action:** ${risk.requiredClarificationOrAction || risk.recommendedAction || ''}`
        );
        if (risk.overrideReason) lines.push(`- **Reviewer rationale:** ${risk.overrideReason}`);
        lines.push('');
      });

    lines.push('## Recommended Actions', '');
    result.rolloutRecommendations.forEach(item => {
      lines.push(`- **${item.phase}:** ${item.action} — ${item.owner}`);
    });
    return lines.join('\n');
  };

  App.copyMarkdownBrief = async function copyMarkdownBrief() {
    if (!this.currentResult) return;
    const markdown = this.buildMarkdownBrief();

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(markdown);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = markdown;
        textarea.readOnly = true;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand('copy')) throw new Error('Browser denied clipboard access.');
        textarea.remove();
      }
      this.showToast('Markdown brief copied to clipboard.');
    } catch (error) {
      this.showToast(`Could not copy the brief: ${error.message}`, 'error');
    }
  };

  App.syncPrintAdvisoryMemo = function reviewerPrintSync() {
    core.syncPrintAdvisoryMemo.call(this);

    const printedItems = [...document.querySelectorAll('#print-risks-body .print-risk-item')];
    this.currentResult.risks.forEach((risk, index) => {
      const item = printedItems[index];
      if (!item) return;
      const assessment = this.assessmentForRisk(risk, index);
      const title = item.querySelector('.print-risk-title span:first-child');
      if (title) {
        title.textContent = `[${assessment.finalSeverity.toUpperCase()}] ${risk.title}`;
      }

      const detail = document.createElement('div');
      detail.className = 'print-reviewer-detail';
      detail.innerHTML = `
        <strong>Reviewer owner:</strong> ${escapeHTML(risk.suggestedOwner || 'Unassigned')} (${escapeHTML(risk.ownerStatus || 'unconfirmed')})<br>
        <strong>Target date:</strong> ${escapeHTML(risk.targetDate || 'Not assigned')}<br>
        <strong>Launch / progression blocker:</strong> ${assessment.blocksLaunch ? 'Yes' : 'No'} / ${assessment.blocksProgression ? 'Yes' : 'No'}
        ${assessment.severityOverrideApplied ? `<br><strong>Severity override:</strong> ${escapeHTML(assessment.calculatedSeverity)} → ${escapeHTML(assessment.finalSeverity)}` : ''}
        ${risk.overrideReason ? `<br><strong>Reviewer rationale:</strong> ${escapeHTML(risk.overrideReason)}` : ''}
      `;
      item.appendChild(detail);
    });
  };

  App.updateExportButtons = function updateExportButtons() {
    const disabled = !this.currentResult;
    const download = document.getElementById('btn-download-json');
    const copy = document.getElementById('btn-copy-md');
    if (download) download.disabled = disabled;
    if (copy) copy.disabled = disabled;
  };

  App.formatDateTime = function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  App.showToast = function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-notification');
    clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.hidden = false;
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3500);
  };
})();
