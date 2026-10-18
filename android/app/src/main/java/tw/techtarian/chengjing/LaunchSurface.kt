package tw.techtarian.chengjing

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.sin

/** A native first frame while WebView initializes, never a timed branding delay. */
internal class LaunchSurface(context: Context, private val background: Int, language: String) : View(context) {
    private val density=resources.displayMetrics.density
    private fun sp(value:Float)=android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP,value,resources.displayMetrics)
    private val dark=Color.luminance(background)<0.4
    private val paint=Paint(Paint.ANTI_ALIAS_FLAG)
    private var phase=0f
    private val pulse=ValueAnimator.ofFloat(0f,1f).apply{
        duration=1300;repeatCount=ValueAnimator.INFINITE;interpolator=LinearInterpolator()
        addUpdateListener{phase=it.animatedValue as Float;invalidate()}
    }
    init {
        contentDescription=when(language){"zh-TW"->"正在開啟 JENZO NOTE";"zh-CN"->"正在打开 JENZO NOTE";"ja"->"JENZO NOTE を起動中";"ko"->"JENZO NOTE 시작 중";else->"Opening JENZO NOTE"}
        importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_YES
        isClickable=false
    }
    override fun onDraw(canvas: Canvas) {
        canvas.drawColor(background)
        val x=width*.14f;val baseline=height*.36f
        paint.style=Paint.Style.FILL;paint.color=if(dark)Color.rgb(238,235,226)else Color.rgb(32,53,44)
        paint.typeface=Typeface.create("sans-serif-medium",Typeface.NORMAL);paint.textSize=sp(30f)
        canvas.drawText("JENZO NOTE",x,baseline,paint)
        for(index in 0..2){
            val opacity=(90+70*sin(phase*6.283185f-index*.7f)).toInt()
            paint.color=if(dark)Color.argb(opacity,53,199,162)else Color.argb(opacity,20,117,95)
            canvas.drawCircle(x+index*11*density,baseline+66*density,1.7f*density,paint)
        }
    }
    override fun onAttachedToWindow(){super.onAttachedToWindow();if(ValueAnimator.areAnimatorsEnabled())pulse.start()}
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event:android.view.MotionEvent)=true // Loading is not a clickable action.
    override fun onDetachedFromWindow(){pulse.cancel();super.onDetachedFromWindow()}
    override fun onWindowVisibilityChanged(visibility:Int){super.onWindowVisibilityChanged(visibility);if(visibility!=VISIBLE)pulse.cancel()else if(isAttachedToWindow&&!pulse.isStarted&&ValueAnimator.areAnimatorsEnabled())pulse.start()}
}
